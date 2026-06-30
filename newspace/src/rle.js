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
  for (const r of runs || []) { const v = r[0], n = r[1] | 0; for (let i = 0; i < n; i++) out.push(v); }
  return out;
}

// encode a value → its RLE form (tagged so decode knows the original shape).
export function rleEncode(v) {
  if (typeof v === "string") return { rle: "s", runs: toRuns([...v]) };
  if (Array.isArray(v)) return { rle: "a", runs: toRuns(v) };
  return v; // not a sequence — nothing to run-length encode
}
// decode an RLE form back to the original value (passes non-RLE values through).
export function rleDecode(v) {
  if (v && v.rle === "s") return fromRuns(v.runs).join("");
  if (v && v.rle === "a") return fromRuns(v.runs);
  return v;
}

// how many elements an RLE form expands to (for readouts / cost checks).
export function rleLength(v) {
  if (v && (v.rle === "s" || v.rle === "a")) return (v.runs || []).reduce((n, r) => n + (r[1] | 0), 0);
  return Array.isArray(v) || typeof v === "string" ? v.length : 0;
}
