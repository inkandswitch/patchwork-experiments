import { describe, it, expect } from "vitest";
import { toBase64, fromBase64, int16ToBytes, bytesToInt16, sampler, decodeTerrain, packQuality, unpackQuality } from "./terrain-sample.js";

describe("base64", () => {
  it("round-trips every byte value, at every length mod 3", () => {
    const all = Uint8Array.from({ length: 256 }, (_, k) => k);
    for (let len = 0; len <= 6; len++) expect([...fromBase64(toBase64(all.subarray(0, len)))]).toEqual([...all.subarray(0, len)]);
    for (const len of [254, 255, 256]) expect([...fromBase64(toBase64(all.subarray(0, len)))]).toEqual([...all.subarray(0, len)]);
  });
  it("matches the standard encoding", () => {
    expect(toBase64(new TextEncoder().encode("Cadboro Bay"))).toBe("Q2FkYm9ybyBCYXk=");
    expect(new TextDecoder().decode(fromBase64("Q2FkYm9ybyBCYXk="))).toBe("Cadboro Bay");
  });
});

describe("int16 little-endian", () => {
  it("round-trips the extremes and the bytes are little-endian", () => {
    const v = Int16Array.from([0, 1, -1, 32767, -32767, -32768, 258]);
    const b = int16ToBytes(v);
    expect([...b.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect([...b.subarray(12, 14)]).toEqual([2, 1]);
    expect([...bytesToInt16(b)]).toEqual([...v]);
  });
});

describe("sampler", () => {
  // a 3 × 2 grid: x 10, 14, 18; z −4, 0
  const g = { nx: 3, nz: 2, x0: 10, z0: -4, cell: 4 };
  const s = sampler(g, Int16Array.from([0, 100, 200, -100, 0, 100]), 0.02, 0.5);

  it("is exact at every node", () => {
    const want = [0.5, 2.5, 4.5, -1.5, 0.5, 2.5];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) expect(s.heightAt(10 + 4 * i, -4 + 4 * j)).toBeCloseTo(want[j * 3 + i], 12);
  });
  it("is bilinear between them", () => {
    expect(s.heightAt(12, -4)).toBeCloseTo(1.5, 12); // between 0.5 and 2.5
    expect(s.heightAt(12, -2)).toBeCloseTo((0.5 + 2.5 - 1.5 + 0.5) / 4, 12); // the cell's middle
    expect(s.heightAt(18, 0)).toBeCloseTo(2.5, 12); // the far corner
  });
  it("says nothing off the grid (open water, no bottom), and depth is level − height", () => {
    expect(s.heightAt(9.99, -2)).toBeNull();
    expect(s.heightAt(12, 0.01)).toBeNull();
    expect(s.depthAt(10, 0)).toBeCloseTo(1.5, 12);
    expect(s.depthAt(10, 0, -2.14)).toBeCloseTo(-0.64, 12);
    expect(s.depthAt(100, 0)).toBeNull();
  });
});

describe("decodeTerrain", () => {
  const t = { version: 1, grid: { nx: 2, nz: 2, x0: 0, z0: 0, cell: 8 }, heights: { encoding: "int16le-base64", scale: 0.02, offset: 0, data: toBase64(int16ToBytes(Int16Array.from([-400, -200, 100, 300]))) }, seaLevel: 0 };
  it("reads extras.terrain", () => {
    const d = decodeTerrain(t);
    expect(d.heightAt(0, 0)).toBeCloseTo(-8, 12);
    expect(d.depthAt(8, 0)).toBeCloseTo(4, 12);
    expect(d.heightAt(8, 8)).toBeCloseTo(6, 12);
  });
  it("refuses a malformed one rather than guessing", () => {
    expect(() => decodeTerrain({ ...t, version: 2 })).toThrow();
    expect(() => decodeTerrain({ ...t, heights: { ...t.heights, encoding: "float32" } })).toThrow();
    expect(() => decodeTerrain({ ...t, grid: { ...t.grid, nx: 3 } })).toThrow(/bytes/);
    expect(() => decodeTerrain(null)).toThrow();
  });
});

describe("node quality, two bits a node", () => {
  it("round-trips every code at every length mod 4", () => {
    for (let len = 0; len <= 9; len++) {
      const v = Uint8Array.from({ length: len }, (_, k) => (k * 3 + 1) & 3);
      const b = packQuality(v);
      expect(b.length).toBe(Math.ceil(len / 4));
      expect([...unpackQuality(b, len)]).toEqual([...v]);
    }
    expect([...packQuality(Uint8Array.from([1, 2, 3, 0]))]).toEqual([0b00111001]);
  });
  it("answers the least trustworthy node a sample reads, and refuses a malformed one", () => {
    const base = { version: 1, grid: { nx: 2, nz: 2, x0: 0, z0: 0, cell: 8 }, heights: { encoding: "int16le-base64", scale: 0.02, offset: 0, data: toBase64(int16ToBytes(Int16Array.from([-400, -200, 100, 300]))) } };
    const names = ["dem", "shore", "raised", "clamped"];
    const d = decodeTerrain({ ...base, quality: { encoding: "uint2-base64", names, data: toBase64(packQuality(Uint8Array.from([0, 3, 1, 0]))) } });
    expect(d.qualityAt(0, 0)).toBe("dem");
    expect(d.qualityAt(8, 0)).toBe("clamped");
    expect(d.qualityAt(0, 8)).toBe("shore");
    expect(d.qualityAt(4, 4)).toBe("clamped");
    expect(d.qualityAt(0, 4)).toBe("shore");
    expect(d.qualityAt(9, 0)).toBeNull();
    expect(decodeTerrain(base).qualityAt(0, 0)).toBeNull();
    expect(() => decodeTerrain({ ...base, quality: { encoding: "uint2-base64", names, data: toBase64(new Uint8Array(3)) } })).toThrow(/quality/);
  });
});
