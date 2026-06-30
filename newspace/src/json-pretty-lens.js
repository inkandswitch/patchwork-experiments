// json-pretty — a BIDIRECTIONAL sketchy:lens that sits on a wire between a JSON
// value and an editable, pretty-printed text view.
//
//   in:json (anySchema)  ──project──▶  out:text (stringSchema)   pretty-printed
//                        ◀─unproject──                           parse back to JSON
//
// project:   JSON.stringify(value, null, 2). Values that can't be JSON-encoded
//            (undefined, a function, a bigint, a cyclic object…) fall back to a
//            plain `"" + value` string so the wire never breaks.
// unproject: JSON.parse(text). On a parse error we return the RAW STRING itself —
//            so a half-typed / non-JSON edit flows through as a literal string
//            rather than vanishing.
//
// Pure helpers `toPretty` / `fromPretty` hold all the logic and are unit-tested.

import { anySchema, stringSchema } from "./ops.js";

// project: a JSON value → pretty 2-space text. Non-JSONable values stringify as
// `"" + value` (e.g. undefined → "undefined", a function → its source).
export function toPretty(value) {
  try {
    const out = JSON.stringify(value, null, 2);
    // JSON.stringify returns `undefined` (the value, not the string) for things
    // like `undefined`, functions, and symbols — fall back to coercion.
    if (out === undefined) return "" + value;
    return out;
  } catch {
    // cyclic structures, bigint, etc.
    return "" + value;
  }
}

// unproject: pretty text → a JSON value. On a parse error, return the raw string
// unchanged so the edit is preserved as a literal.
export function fromPretty(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const plugin = {
  type: "sketchy:lens",
  id: "json-pretty",
  name: "pretty JSON",
  icon: "Braces",
  inlet: { name: "in", type: "json", schema: anySchema() },
  outlet: { name: "out", type: "text", schema: stringSchema() },
  project: (v) => toPretty(v),
  unproject: (text) => fromPretty(text),
};
