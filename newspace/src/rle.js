// Run-length encoding for values passing through an opstream. RLE collapses RUNS of equal
// elements to [value, count] pairs — a real win for repetitive data (a row of the same
// colour, repeated tokens, a flat field that rarely changes). Works on arrays and strings;
// any other value passes through untouched. It ROUND-TRIPS, so it rides a wire as a lens:
// encode at one end, decode at the other (or a single bidi lens whose view is compressed).
import { valuesEqual } from "./ops.js";

// runs: [[value, count], …]
function toRuns(arr) {
  const runs = [];
  for (const x of arr) {
    const last = runs[runs.length - 1];
    if (last && valuesEqual(last[0], x)) last[1]++;
    else runs.push([x, 1]);
  }
  return runs;
}
function fromRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    const v = r[0], n = r[1] | 0;
    // CLONE per repetition — pushing the same object reference n times would decode
    // a run of n equal objects to n ALIASES (mutate one, all n change)
    for (let i = 0; i < n; i++) out.push(v !== null && typeof v === "object" ? structuredClone(v) : v);
  }
  return out;
}

// does a value already LOOK like our encoded form? Such a value must be escape-
// wrapped on encode (and only unwrapped on decode), or decode(encode(v)) ≠ v —
// the first write-back through the lens would corrupt a genuine {rle, runs} value.
const looksEncoded = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) && (v.rle === "s" || v.rle === "a" || v.rle === "esc");

// encode a value → its RLE form (tagged so decode knows the original shape).
export function rleEncode(v) {
  if (typeof v === "string") return { rle: "s", runs: toRuns([...v]) };
  if (Array.isArray(v)) return { rle: "a", runs: toRuns(v) };
  if (looksEncoded(v)) return { rle: "esc", value: v }; // collision → escape-wrap
  return v; // not a sequence — nothing to run-length encode
}
// decode an RLE form back to the original value (passes non-RLE values through).
export function rleDecode(v) {
  if (!v || typeof v !== "object") return v;
  if (v.rle === "esc") return v.value; // unwrap an escaped passthrough
  if (v.rle === "s" && Array.isArray(v.runs)) return fromRuns(v.runs).join("");
  if (v.rle === "a" && Array.isArray(v.runs)) return fromRuns(v.runs);
  return v;
}

// how many elements an RLE form expands to (for readouts / cost checks).
export function rleLength(v) {
  if (v && v.rle === "esc") return rleLength(v.value);
  if (v && (v.rle === "s" || v.rle === "a")) return (v.runs || []).reduce((n, r) => n + (r[1] | 0), 0);
  return Array.isArray(v) || typeof v === "string" ? v.length : 0;
}
