import { describe, it, expect } from "vitest";
import { rleEncode, rleDecode, rleLength } from "../src/rle.js";

describe("RLE — run-length encode/decode through an opstream", () => {
  it("collapses runs in an array and round-trips", () => {
    const a = [1, 1, 1, 2, 2, 3];
    const enc = rleEncode(a);
    expect(enc).toEqual({ rle: "a", runs: [[1, 3], [2, 2], [3, 1]] });
    expect(rleDecode(enc)).toEqual(a);
  });
  it("compresses a repetitive string and round-trips", () => {
    const s = "aaabbbbc";
    const enc = rleEncode(s);
    expect(enc).toEqual({ rle: "s", runs: [["a", 3], ["b", 4], ["c", 1]] });
    expect(rleDecode(enc)).toBe(s);
  });
  it("runs of equal OBJECTS collapse (deep equality)", () => {
    const a = [{ c: "red" }, { c: "red" }, { c: "blue" }];
    expect(rleEncode(a)).toEqual({ rle: "a", runs: [[{ c: "red" }, 2], [{ c: "blue" }, 1]] });
    expect(rleDecode(rleEncode(a))).toEqual(a);
  });
  it("non-sequence values pass through untouched", () => {
    expect(rleEncode(42)).toBe(42);
    expect(rleEncode({ x: 1 })).toEqual({ x: 1 });
    expect(rleDecode({ x: 1 })).toEqual({ x: 1 });
  });
  it("rleLength reports the decoded length", () => {
    expect(rleLength(rleEncode([5, 5, 5, 5]))).toBe(4);
    expect(rleLength("abc")).toBe(3);
  });
});

describe("RLE is self-distinguishing — a genuine {rle, runs}-shaped VALUE survives", () => {
  it("decode(encode(v)) round-trips a value that collides with the marker shape", () => {
    const v = { rle: "a", runs: [[1, 2]] }; // a GENUINE value that merely looks encoded
    const enc = rleEncode(v);
    expect(enc).toEqual({ rle: "esc", value: v }); // escape-wrapped, not passed raw
    expect(rleDecode(enc)).toEqual(v); // round-trips intact — decode∘encode = id
  });
  it("the escape wrapper itself round-trips (double collision)", () => {
    const v = { rle: "esc", value: { x: 1 } };
    expect(rleDecode(rleEncode(v))).toEqual(v);
  });
  it("a malformed rle-ish object without a runs ARRAY is never expanded", () => {
    const v = { rle: "s" }; // no runs — decode must not fabricate ""
    expect(rleDecode(v)).toEqual(v);
    expect(rleDecode(rleEncode(v))).toEqual(v);
  });
});

describe("RLE decode does not ALIAS repeated objects", () => {
  it("a run of n equal objects decodes to n independent clones", () => {
    const out = rleDecode(rleEncode([{ c: "red" }, { c: "red" }]));
    expect(out).toEqual([{ c: "red" }, { c: "red" }]);
    expect(out[0]).not.toBe(out[1]); // distinct references
    out[0].c = "blue"; // mutating one…
    expect(out[1].c).toBe("red"); // …leaves the other alone
  });
});
