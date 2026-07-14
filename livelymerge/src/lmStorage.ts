/** Plain keys that Automerge materializations may spuriously expose — never delegate on these. */
const LM_INTRINSIC_PLAIN_KEYS = new Set(['toString', 'valueOf', 'constructor', '__proto__']);

function lmIsDelegatablePlainKey(plain: string): boolean {
  return !plain.startsWith('$') && !LM_INTRINSIC_PLAIN_KEYS.has(plain);
}

export function lmIsReservedKey(prop: PropertyKey): boolean {
  return typeof prop === 'string' && prop.startsWith('$');
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

export function lmSetOwn(
  entry: Record<string, any>,
  prop: PropertyKey,
  value: unknown,
  serialize: (value: unknown) => unknown,
): boolean {
  if (typeof prop === 'symbol' || lmIsReservedKey(prop)) return false;
  entry[lmUserKey(prop)] = serialize(value);
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
