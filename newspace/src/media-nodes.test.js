import { describe, it, expect } from "vitest";
import { pixelsToRGBA } from "./media-nodes.js";

describe("pixelsToRGBA — normalise a raw pixel buffer to RGBA", () => {
  it("null/undefined → null", () => {
    expect(pixelsToRGBA(null)).toBe(null);
    expect(pixelsToRGBA(undefined)).toBe(null);
  });

  it("a byte RGBA array passes through with given dims", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]); // 2 px
    const r = pixelsToRGBA(data, { width: 2, height: 1, channels: 4 });
    expect(r.width).toBe(2); expect(r.height).toBe(1);
    expect([...r.data]).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("grayscale (1 channel) fans out to r=g=b, opaque alpha", () => {
    const r = pixelsToRGBA(new Uint8Array([100, 200]), { width: 2, height: 1, channels: 1 });
    expect([...r.data]).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it("3-channel RGB gets a full-opacity alpha added", () => {
    const r = pixelsToRGBA(new Uint8Array([1, 2, 3]), { width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([1, 2, 3, 255]);
  });

  it("float values in 0..1 scale by 255 (unit)", () => {
    const r = pixelsToRGBA(new Float32Array([0, 0.5, 1]), { width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([0, 128, 255, 255]); // Uint8ClampedArray rounds 127.5 → 128
  });

  it("float values outside 0..1 auto-stretch to the min–max range", () => {
    // values 10..20 over one gray pixel pair → min maps to 0, max to 255
    const r = pixelsToRGBA(new Float32Array([10, 20]), { width: 2, height: 1, channels: 1 });
    expect(r.data[0]).toBe(0);   // 10 → 0
    expect(r.data[4]).toBe(255); // 20 → 255
  });

  it("infers a square when dims are absent (RGBA)", () => {
    const r = pixelsToRGBA(new Uint8Array(2 * 2 * 4), { channels: 4 }); // 4 px → 2×2
    expect(r.width).toBe(2); expect(r.height).toBe(2);
  });

  it("{ data, width, height } object form carries its own dims", () => {
    const r = pixelsToRGBA({ data: new Uint8Array([5, 6, 7]), width: 1, height: 1, channels: 3 });
    expect([...r.data]).toEqual([5, 6, 7, 255]);
  });

  it("non-array junk → null", () => {
    expect(pixelsToRGBA({ nope: 1 })).toBe(null);
    expect(pixelsToRGBA(42)).toBe(null);
  });
});
