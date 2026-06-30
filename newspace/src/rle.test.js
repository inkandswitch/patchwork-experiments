import { describe, it, expect } from "vitest";
import { rleEncode, rleDecode, rleLength } from "./rle.js";

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
