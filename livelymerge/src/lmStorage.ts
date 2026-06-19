export function lmIsReservedKey(prop: PropertyKey): boolean {
  return typeof prop === 'string' && prop.startsWith('$');
}

export function lmUserKey(prop: PropertyKey): string {
  return '@' + String(prop);
}

export function lmGetOwn(entry: Record<string, any>, prop: PropertyKey): unknown {
  if (typeof prop === 'symbol') return undefined;
  const userKey = lmUserKey(prop);
  if (Object.hasOwn(entry, userKey)) return entry[userKey];
  const plain = String(prop);
  if (Object.hasOwn(entry, plain)) return entry[plain];
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
  return Object.hasOwn(entry, lmUserKey(prop)) || Object.hasOwn(entry, prop);
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

export function lmGetWithDelegation(
  entry: LmProtoEntry & Record<string, any>,
  prop: PropertyKey,
  protoTable: Record<string, LmProtoEntry & Record<string, any>>,
  deserialize: (value: unknown) => unknown,
): unknown {
  if (typeof prop === 'symbol') return undefined;
  const userKey = lmUserKey(prop);
  const plain = String(prop);
  let current: (LmProtoEntry & Record<string, any>) | undefined = entry;
  while (current) {
    if (Object.hasOwn(current, userKey)) return deserialize(current[userKey]);
    if (!plain.startsWith('$') && Object.hasOwn(current, plain)) return deserialize(current[plain]);
    if (current.$protoId) current = protoTable[current.$protoId];
    else break;
  }
  return undefined;
}

export function lmOwnUserPropertyKeys(entry: Record<string, any>): string[] {
  return Object.getOwnPropertyNames(entry)
    .filter((p) => p.startsWith('@'))
    .map((p) => p.slice(1));
}
