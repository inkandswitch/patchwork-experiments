import { JSONExt } from '@lumino/coreutils';
import { automerge, realm } from './automerge';

/**
 * Convert a JSON value for storage in Automerge. Strings become immutable
 * scalars (they are opaque values in nbformat, not collaborative text) and
 * `undefined` entries are dropped since Automerge cannot store them.
 */
export function toAutomerge(value: unknown): unknown {
  return adopt(value, true);
}

/**
 * Deep copy a value into Automerge's realm, dropping `undefined`. With
 * `immutableStrings`, strings become ImmutableString; otherwise they stay
 * plain and are stored as collaborative text.
 */
export function adopt(value: unknown, immutableStrings = false): unknown {
  if (typeof value === 'string') {
    return immutableStrings ? new (automerge().ImmutableString)(value) : value;
  }
  if (value === null || typeof value !== 'object' || value instanceof automerge().ImmutableString) {
    return value;
  }
  const { Array: RealmArray, Object: RealmObject, Uint8Array: RealmUint8Array } = realm();
  if (ArrayBuffer.isView(value)) {
    return new RealmUint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Array.isArray(value)) {
    return RealmArray.from(value, item => (item === undefined ? null : adopt(item, immutableStrings)));
  }
  const result = new RealmObject() as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = adopt(item, immutableStrings);
    }
  }
  return result;
}

/** An empty map or list, made in Automerge's realm. */
export function emptyMap(): Record<string, any> {
  return new (realm().Object)() as Record<string, any>;
}

export function emptyList(): any[] {
  return new (realm().Array)();
}

/** Deep copy a value read from an Automerge document into plain JSON. */
export function toPlain<T = any>(value: unknown): T {
  if (value === null || typeof value !== 'object') {
    return value as T;
  }
  // isImmutableString() is also true for list proxies inside a change.
  if (value instanceof automerge().ImmutableString) {
    return value.toString() as T;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) as T;
  }
  if (Array.isArray(value)) {
    return Array.from(value as ArrayLike<unknown>, item => toPlain(item)) as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toPlain(item);
  }
  return result as T;
}

/** JSONExt.deepEqual, tolerating undefined on either side. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return JSONExt.deepEqual(a as any, b as any);
}

/** Read a string that may be stored as text or as an immutable string. */
export function readString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

/** Assign a key, deleting it when the value is undefined. */
export function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = toAutomerge(value);
  }
}

/** Recursively sort JSON object keys without changing array order or input data. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => sortKeys(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    for (const [key, item] of entries) {
      Object.defineProperty(sorted, key, {
        value: sortKeys(item),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return sorted as T;
  }
  return value;
}
