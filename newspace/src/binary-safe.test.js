import { describe, it, expect } from "vitest";
import { isBinary, describeBinary, binarySafeReplacer, valuesEqual } from "./ops.js";

describe("isBinary", () => {
  it("flags typed arrays, ArrayBuffer, ImageData", () => {
    expect(isBinary(new Uint8Array(4))).toBe(true);
    expect(isBinary(new Float32Array(4))).toBe(true);
    expect(isBinary(new ArrayBuffer(8))).toBe(true);
    expect(isBinary(new ImageData(2, 2))).toBe(true);
  });
  it("does not flag plain values", () => {
    expect(isBinary({ a: 1 })).toBe(false);
    expect(isBinary([1, 2, 3])).toBe(false);
    expect(isBinary("hi")).toBe(false);
    expect(isBinary(null)).toBe(false);
  });
});

describe("describeBinary — short tag instead of megabytes", () => {
  it("ImageData → dimensions", () => {
    expect(describeBinary(new ImageData(640, 480))).toBe("[ImageData 640×480]");
  });
  it("typed array → name + length", () => {
    expect(describeBinary(new Uint8Array(10))).toBe("[Uint8Array(10)]");
    expect(describeBinary(new Float32Array(3))).toBe("[Float32Array(3)]");
  });
  it("ArrayBuffer → byte length", () => {
    expect(describeBinary(new ArrayBuffer(16))).toBe("[ArrayBuffer 16b]");
  });
  it("non-binary → null", () => {
    expect(describeBinary({ a: 1 })).toBe(null);
    expect(describeBinary("x")).toBe(null);
  });
});

describe("binarySafeReplacer — JSON.stringify never expands a frame", () => {
  it("replaces a nested ImageData with its tag (no pixel explosion)", () => {
    const v = { frame: new ImageData(320, 240), n: 5 };
    const s = JSON.stringify(v, binarySafeReplacer);
    expect(s).toContain("[ImageData 320×240]");
    expect(s).toContain('"n":5');
    expect(s.length).toBeLessThan(200); // would be megabytes without the replacer
  });
});

describe("valuesEqual — binary compared by identity, never stringified", () => {
  it("two distinct frames are not equal (and don't freeze)", () => {
    const a = new ImageData(800, 600), b = new ImageData(800, 600);
    expect(valuesEqual(a, b)).toBe(false); // distinct refs
  });
  it("the same frame ref is equal", () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(valuesEqual(a, a)).toBe(true);
  });
  it("plain structures still deep-compare", () => {
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
