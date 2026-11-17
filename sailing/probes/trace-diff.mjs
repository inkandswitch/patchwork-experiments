// Two sailing-run traces (--trace <file>), compared row by row.
//
//   node probes/trace-diff.mjs <a.jsonl> <b.jsonl> [--until <mark>]
//
// A trace is one JSON row per ship per step of world time the computing view
// took ([view, grid t, ship, spec key's hash, controls, state], the state
// unrounded), with the runner's marks ({ mark, t }) where it made them. With
// --until, each is cut after its first row marked <mark> (e.g. "left": the
// leave step's end). Prints the first row that differs, by index, with every
// field that differs there (its path, both values), and the rows before it
// in both; or that they are identical. Exits 1 when they differ.
import { readFileSync } from "node:fs";

const [fa, fb] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--until");
const i = process.argv.indexOf("--until");
const until = i > 0 ? process.argv[i + 1] : null;

/** A trace's rows, cut after the `until` mark. */
export function rowsOf(text, until = null) {
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (until == null) return rows;
  const end = rows.findIndex((r) => r && r.mark === until);
  return end < 0 ? rows : rows.slice(0, end + 1);
}

/** Every path at which two plain values differ: [path, a, b]. */
export function differences(a, b, path = "") {
  if (Object.is(a, b)) return [];
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [[path || "(row)", a, b]];
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...differences(a[k], b[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`));
  return out;
}

/** The first row at which two traces differ: { index, fields } or null (identical, the same length). */
export function firstDifference(A, B) {
  const n = Math.max(A.length, B.length);
  for (let k = 0; k < n; k++) {
    const d = differences(A[k], B[k]);
    if (d.length) return { index: k, fields: d };
  }
  return null;
}

if (fa && fb) {
  const A = rowsOf(readFileSync(fa, "utf8"), until), B = rowsOf(readFileSync(fb, "utf8"), until);
  const d = firstDifference(A, B);
  const label = (r) => (r == null ? "(none)" : r.mark != null ? `mark ${r.mark} at t ${r.t}` : `${r[0]} t ${r[1]}`);
  if (!d) {
    console.log(JSON.stringify({ identical: true, rows: A.length, until, last: label(A[A.length - 1]) }));
  } else {
    const marks = (R) => R.slice(0, d.index).filter((r) => r && r.mark != null).slice(-3);
    console.log(JSON.stringify({ identical: false, rows: [A.length, B.length], until, index: d.index, at: [label(A[d.index]), label(B[d.index])], lastMarks: marks(A), fields: d.fields.slice(0, 40), before: [A[d.index - 1], B[d.index - 1]] }, null, 1));
    process.exitCode = 1;
  }
}
