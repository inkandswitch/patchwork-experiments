// Tokenizer for the implicit-surface language.
//
// Tokens: numbers (with an optional unit suffix: 5mm, 2.5cm, 1in, 30deg),
// identifiers, the keyword `let`, operators + - * / ^, and ( ) , = ;.
// Comments are `// to end of line` and `/* block */`.
// Each token records whether a line break came before it (`nl`), which the
// parser uses to end a `let` without a semicolon.

import { ImplicitError } from "./errors.js";

/** Unit suffixes, as multipliers into metres (lengths) or radians (angles). */
export const UNITS = Object.freeze({
  m: 1,
  cm: 0.01,
  mm: 0.001,
  um: 1e-6,
  in: 0.0254,
  ft: 0.3048,
  deg: Math.PI / 180,
  rad: 1,
});

export const KEYWORDS = new Set(["let"]);

const isDigit = (c) => c >= 48 && c <= 57;
const isIdentStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdentPart = (c) => isIdentStart(c) || isDigit(c);

const SINGLE = { "+": "op", "-": "op", "*": "op", "/": "op", "^": "op", "(": "(", ")": ")", ",": ",", "=": "=", ";": ";" };

/**
 * @typedef {{ type: "num"|"ident"|"kw"|"op"|"("|")"|","|"="|";"|"eof"|"comment"|"error",
 *             value: any, start: number, end: number, nl: boolean, unit?: string }} Token
 */

/**
 * Split source into tokens.
 * @param {string} source
 * @param {{ comments?: boolean, lenient?: boolean }} [opts]
 *   comments: also emit comment tokens (for syntax highlighting)
 *   lenient:  never throw; emit an "error" token and keep going
 * @returns {Token[]}  always ends with an "eof" token
 */
export function tokenize(source, opts = {}) {
  const src = String(source ?? "");
  const out = [];
  let i = 0;
  let nl = true; // start of input counts as a fresh line
  const fail = (message, start, end) => {
    if (!opts.lenient) throw new ImplicitError(message, start, end);
    out.push({ type: "error", value: message, start, end, nl });
    nl = false;
  };

  while (i < src.length) {
    const c = src.charCodeAt(i);
    // whitespace
    if (c === 10) {
      nl = true;
      i++;
      continue;
    }
    if (c === 32 || c === 9 || c === 13 || c === 12 || c === 11 || c === 0xa0) {
      i++;
      continue;
    }
    // comments
    if (c === 47 && src.charCodeAt(i + 1) === 47) {
      const start = i;
      while (i < src.length && src.charCodeAt(i) !== 10) i++;
      if (opts.comments) out.push({ type: "comment", value: src.slice(start, i), start, end: i, nl });
      continue;
    }
    if (c === 47 && src.charCodeAt(i + 1) === 42) {
      const start = i;
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      if (src.slice(start, end).includes("\n")) nl = true;
      if (opts.comments) out.push({ type: "comment", value: src.slice(start, end), start, end, nl });
      i = end;
      if (close < 0) fail("This /* comment is never closed — add */ to end it.", start, start + 2);
      continue;
    }
    // numbers: 12, 1.5, .5, 1e-3, 2.5e+2, optionally followed by a unit
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      const start = i;
      while (isDigit(src.charCodeAt(i))) i++;
      if (src.charCodeAt(i) === 46) {
        i++;
        while (isDigit(src.charCodeAt(i))) i++;
      }
      const e = src.charCodeAt(i);
      if (e === 101 || e === 69) {
        // exponent only if followed by digits (so `2em` is not half an exponent)
        let j = i + 1;
        const s = src.charCodeAt(j);
        if (s === 43 || s === 45) j++;
        if (isDigit(src.charCodeAt(j))) {
          i = j;
          while (isDigit(src.charCodeAt(i))) i++;
        }
      }
      const raw = src.slice(start, i);
      let value = Number(raw);
      let unit;
      if (isIdentStart(src.charCodeAt(i))) {
        const us = i;
        while (isIdentPart(src.charCodeAt(i))) i++;
        unit = src.slice(us, i);
        if (!Object.hasOwn(UNITS, unit)) {
          fail(
            `"${unit}" is not a unit. Numbers can end in ${Object.keys(UNITS).join(", ")} — or put a * between a number and a name.`,
            us,
            i,
          );
          continue;
        }
        value *= UNITS[unit];
      }
      if (!Number.isFinite(value)) {
        fail(`The number ${raw} is too large.`, start, i);
        continue;
      }
      out.push({ type: "num", value, start, end: i, nl, unit });
      nl = false;
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (isIdentPart(src.charCodeAt(i))) i++;
      const name = src.slice(start, i);
      out.push({ type: KEYWORDS.has(name) ? "kw" : "ident", value: name, start, end: i, nl });
      nl = false;
      continue;
    }
    const ch = src[i];
    if (Object.hasOwn(SINGLE, ch)) {
      out.push({ type: SINGLE[ch], value: ch, start: i, end: i + 1, nl });
      nl = false;
      i++;
      continue;
    }
    // anything else is a stray character; name the common confusions
    const hint =
      ch === "{" || ch === "}"
        ? " Blocks are not needed: write `let name = …` lines, then one final shape."
        : ch === "[" || ch === "]"
          ? " There are no lists or vectors — pass x, y and z as separate numbers."
          : ch === '"' || ch === "'" || ch === "`"
            ? " There are no strings in this language."
            : ch === "%"
              ? " Use mod(a, b) for the remainder."
              : "";
    const cp = src.codePointAt(i);
    const width = cp > 0xffff ? 2 : 1;
    fail(`Unexpected character "${String.fromCodePoint(cp)}".${hint}`, i, i + width);
    i += width;
  }
  out.push({ type: "eof", value: null, start: src.length, end: src.length, nl: true });
  return out;
}
