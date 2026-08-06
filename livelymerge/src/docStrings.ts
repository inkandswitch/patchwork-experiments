/**
 * Immutable-string document encoding.
 *
 * Automerge's default representation for a JS string is collaborative Text:
 * one op to make the text object plus one op PER CHARACTER — a fresh $id costs
 * ~20 ops, a function's $code hundreds. Livelymerge never edits stored strings
 * in place (ids, type tags, code, and user string values are opaque,
 * replace-whole values), so everything the runtime stores in the document is
 * wrapped as an Automerge ImmutableString instead: a single scalar op
 * regardless of length, and a smaller saved document.
 *
 * Automerge detects the wrapper by a registered symbol (not instanceof), so
 * this module needs no dependency on the automerge package and works across
 * duplicate automerge copies.
 *
 * Boundary discipline: strings are PLAIN everywhere in memory (shadow table,
 * materialized copies, user-facing values). Wrap with wrapStoredVal /
 * wrapEntryForDoc exactly at document writes; unwrap at document reads
 * (materializeStoredVal / deserialize / strVal). Reads must also tolerate
 * plain strings from documents written before this encoding existed —
 * Automerge materializes their Text values as ordinary strings.
 *
 * Strings nested inside plain-JSON leaf values (e.g. a stored String.split
 * result) are deliberately NOT wrapped: those leaves are read back verbatim,
 * so a wrapper would leak into user code. They keep the Text encoding.
 */

const IMMUTABLE_STRING = Symbol.for('_am_immutableString');

/** Matches Automerge's ImmutableString contract (symbol tag, .val, toString). */
export class DocString {
  val: string;
  constructor(val: string) {
    (this as Record<symbol, unknown>)[IMMUTABLE_STRING] = true;
    this.val = val;
  }
  toString(): string {
    return this.val;
  }
  toJSON(): string {
    return this.val;
  }
}

/** True for any immutable-string wrapper: ours, or one an Automerge read returned. */
export function isDocString(x: unknown): x is { val: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Record<symbol, unknown>)[IMMUTABLE_STRING] === true
  );
}

/** Unwrap an immutable-string wrapper; every other value passes through. */
export function strVal(x: any): any {
  return isDocString(x) ? x.val : x;
}

/** A stored value's $type tag as a plain string, whichever encoding it uses. */
export function typeTag(x: any): unknown {
  return strVal(x?.$type);
}

/** Encode one stored value (a Val) for a document write. */
export function wrapStoredVal(v: any): any {
  if (typeof v === 'string') return new DocString(v);
  if (v === null || typeof v !== 'object') return v;
  const t = typeTag(v);
  if (t === 'ref') {
    return { $type: new DocString('ref'), $id: new DocString(strVal(v.$id)) };
  }
  if (t === 'accessor') {
    const acc: any = { $type: new DocString('accessor') };
    if (v.$get) acc.$get = wrapStoredVal(v.$get);
    if (v.$set) acc.$set = wrapStoredVal(v.$set);
    return acc;
  }
  return v; // Date, Uint8Array, plain-JSON leaf, or an already-wrapped DocString
}

/** Encode a whole heap entry (Obj | Arr | Fun) for a document write. */
export function wrapEntryForDoc<T extends Record<string, any>>(entry: T): T {
  const out: Record<string, any> = {};
  for (const k of Object.keys(entry)) {
    const v = entry[k];
    out[k] = k === '$values' || k === '$scopes' ? v.map(wrapStoredVal) : wrapStoredVal(v);
  }
  return out as T;
}
