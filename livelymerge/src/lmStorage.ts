/** Plain keys that Automerge materializations may spuriously expose — never delegate on these. */
const LM_INTRINSIC_PLAIN_KEYS = new Set(['toString', 'valueOf', 'constructor', '__proto__']);

function lmIsDelegatablePlainKey(plain: string): boolean {
  return !plain.startsWith('$') && !LM_INTRINSIC_PLAIN_KEYS.has(plain);
}

export function lmIsReservedKey(prop: PropertyKey): boolean {
  return typeof prop === 'string' && prop.startsWith('$');
}

/**
 * The proxy protocol keys. These are the only `$`-names with fixed runtime meaning on
 * every proxy; all other `$`-prefixed property names denote *ephemeral* (per-replica,
 * non-persistent) properties, stored in a sidecar map outside the heap. Heap entries
 * themselves still never store user keys beginning with `$` (user keys are `@`-prefixed),
 * so ephemeral properties can never leak into the Automerge document.
 */
export const LM_PROXY_PROTOCOL_KEYS = new Set(['$isProxy', '$id', '$toRef', '$unwrapped']);

export function lmIsProtocolKey(prop: PropertyKey): boolean {
  return typeof prop === 'string' && LM_PROXY_PROTOCOL_KEYS.has(prop);
}

/** True for user-facing ephemeral property names: `$foo` but not the proxy protocol keys. */
export function lmIsEphemeralKey(prop: PropertyKey): boolean {
  return (
    typeof prop === 'string' && prop.startsWith('$') && !LM_PROXY_PROTOCOL_KEYS.has(prop)
  );
}

export function lmUserKey(prop: PropertyKey): string {
  const plain = String(prop);
  return plain.startsWith('@') ? plain : '@' + plain;
}

export function lmHeapHasOwn(entry: Record<string, unknown>, key: string): boolean {
  if (Object.hasOwn(entry, key)) return true;
  // Automerge materializations may expose @-prefixed keys via `in` but not Object.hasOwn.
  // Never use `in` for plain names like "toString" — that inherits from Object.prototype.
  if (key.startsWith('@') && key in entry) return true;
  return false;
}

export function lmHeapGet(entry: Record<string, unknown>, key: string): unknown {
  if (lmHeapHasOwn(entry, key)) return entry[key];
  return undefined;
}

export function lmGetOwn(entry: Record<string, any>, prop: PropertyKey): unknown {
  if (typeof prop === 'symbol') return undefined;
  const userKey = lmUserKey(prop);
  if (lmHeapHasOwn(entry, userKey)) return entry[userKey];
  const plain = String(prop);
  if (lmIsDelegatablePlainKey(plain) && Object.hasOwn(entry, plain)) return entry[plain];
  return undefined;
}

/** True when writing `next` over `cur` would be a no-op we can skip. Covers
 * primitives (including strings — significant under Automerge text encoding, where a
 * rewritten string costs one op per character), Refs to the same object, and equal
 * Dates. Plain objects/arrays always rewrite (deep comparison is not worth it, and
 * list identity matters). Note the CRDT nuance: an elided same-value write no longer
 * asserts LWW recency; Livelymerge accepts that trade for op economy. */
export function lmSameStoredVal(cur: unknown, next: unknown): boolean {
  if (cur === next) return typeof next !== 'object' || next === null;
  if (cur == null || next == null) return false;
  const c = cur as any;
  const n = next as any;
  if (c.$type === 'ref' && n.$type === 'ref') return c.$id === n.$id;
  if (cur instanceof Date && next instanceof Date) return cur.getTime() === next.getTime();
  return false;
}

export function lmSetOwn(
  entry: Record<string, any>,
  prop: PropertyKey,
  value: unknown,
  serialize: (value: unknown) => unknown,
): boolean {
  if (typeof prop === 'symbol' || lmIsReservedKey(prop)) return false;
  const key = lmUserKey(prop);
  const next = serialize(value);
  // Same-value elision: skip the store when nothing would change. This is what makes
  // "no persistent ops on an idle frame" a robust property rather than a coding
  // discipline — idempotent per-frame/per-event writes (didDrag = false, actorID =
  // null, ...) cost nothing.
  if (Object.hasOwn(entry, key) && lmSameStoredVal(entry[key], next)) return true;
  entry[key] = next;
  return true;
}

export function lmHasOwnUser(entry: Record<string, any>, prop: string): boolean {
  return lmHeapHasOwn(entry, lmUserKey(prop)) || (lmIsDelegatablePlainKey(prop) && Object.hasOwn(entry, prop));
}

export interface LmHeapEntry {
  $id: string;
  $protoId?: string;
}

export function lmObjDelegatesTo(
  obj: LmHeapEntry,
  proto: LmHeapEntry,
  lookup: (id: string) => LmHeapEntry | undefined,
): boolean {
  let current: LmHeapEntry | undefined = obj;
  while (current) {
    if (current.$id === proto.$id) return true;
    if (!current.$protoId) return false;
    current = lookup(current.$protoId);
  }
  return false;
}

export interface LmProtoEntry {
  $protoId?: string;
}

export type LmHeapLookup = (id: string) => (LmProtoEntry & Record<string, any>) | undefined;

export function lmGetWithDelegation(
  entry: LmProtoEntry & Record<string, any>,
  prop: PropertyKey,
  lookup: LmHeapLookup,
  deserialize: (value: unknown) => unknown,
): unknown {
  if (typeof prop === 'symbol') return undefined;
  const userKey = lmUserKey(prop);
  const plain = String(prop);
  let current: (LmProtoEntry & Record<string, any>) | undefined = entry;
  while (current) {
    if (lmHeapHasOwn(current, userKey)) return deserialize(lmHeapGet(current, userKey));
    if (lmIsDelegatablePlainKey(plain) && Object.hasOwn(current, plain)) {
      return deserialize(current[plain]);
    }
    if (current.$protoId) current = lookup(current.$protoId);
    else break;
  }
  return undefined;
}

export function lmHeapPropertyNames(entry: Record<string, unknown>): string[] {
  const keys = new Set<string>(Object.getOwnPropertyNames(entry));
  for (const p in entry) {
    if (p.startsWith('@') && lmHeapHasOwn(entry, p)) keys.add(p);
  }
  return [...keys];
}

export function lmOwnUserPropertyKeys(entry: Record<string, any>): string[] {
  return lmHeapPropertyNames(entry)
    .filter((p) => p.startsWith('@'))
    .map((p) => p.slice(1));
}

export function lmCallToString(
  entry: LmProtoEntry & Record<string, unknown> & LmHeapEntry,
  receiver: unknown,
  lookup: LmHeapLookup,
  deserialize: (value: unknown) => unknown,
): string {
  const method = lmGetWithDelegation(entry, 'toString', lookup, deserialize);
  if (method !== undefined) {
    return Reflect.apply(method as (...args: unknown[]) => string, receiver, []);
  }
  return `[obj ${entry.$id}]`;
}
