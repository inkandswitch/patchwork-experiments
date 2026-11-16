import { describe, it, expect } from "vitest";
import { layerHeights, sourceNames, packLayers, unpackLayers, sourceAgreement, canopyBytes, FILLED, FLOOR, CANOPY_SCALE } from "./layered.js";

const heights = { water: ["A", "B"], land: ["C", "A"] };

describe("layerHeights", () => {
  it("takes, at each node, the first source on its side of the water that has a value; else fills the water and floors the land (every case)", () => {
    // 16 nodes: every combination of A, B, C having a value, on land and on water
    const n = 4, N = 16;
    const label = new Int8Array(N), values = { A: new Float32Array(N).fill(NaN), B: new Float32Array(N).fill(NaN), C: new Float32Array(N).fill(NaN) };
    for (let k = 0; k < N; k++) {
      label[k] = k < 8 ? 1 : -1;
      const m = k % 8;
      if (m & 1) values.A[k] = 100 + k;
      if (m & 2) values.B[k] = 200 + k;
      if (m & 4) values.C[k] = 300 + k;
    }
    const out = layerHeights({ n, heights, values, label, landFloor: 2.23 });
    const names = sourceNames(heights);
    expect(names).toEqual(["A", "B", "C", FILLED, FLOOR]);
    for (let k = 0; k < N; k++) {
      const m = k % 8;
      const order = label[k] > 0 ? [["C", 4], ["A", 1]] : [["A", 1], ["B", 2]];
      const first = order.find(([, bit]) => m & bit)?.[0] ?? null;
      if (first) {
        expect(names[out.source[k]]).toBe(first);
        expect(out.heights[k]).toBe(values[first][k]);
        expect(out.want[k]).toBe(0);
      } else if (label[k] > 0) {
        expect(names[out.source[k]]).toBe(FLOOR);
        expect(out.heights[k]).toBeCloseTo(2.23, 6);
      } else {
        expect(names[out.source[k]]).toBe(FILLED);
        expect(out.heights[k]).toBeNaN();
        expect(out.want[k]).toBe(1);
      }
    }
    expect(Object.values(out.counts).reduce((a, b) => a + b, 0)).toBe(N);
  });
  it("takes a raw 0 from a source that writes 0 for 'no depth' (NCEI) as no value on water, and as a height on land (every case, at two datum offsets)", () => {
    for (const toMWL of [0, -2.04]) {
      const h = { water: ["Z", "B"], land: ["Z"], rasters: { Z: { zeroIsNoValueOnWater: true, toMWL }, B: {} } };
      // nodes: land or water × Z none, a raw 0 or 5 × B none or 7
      const cases = [];
      for (const lab of [1, -1]) for (const z of [NaN, 0, 5]) for (const bv of [NaN, 7]) cases.push([lab, z, bv]);
      // 12 cases on a 4 × 4 grid, the last four land with nothing (floored, not checked)
      while (cases.length < 16) cases.push([1, NaN, NaN]);
      const label = Int8Array.from(cases.map((c) => c[0]));
      const values = { Z: Float32Array.from(cases.map((c) => c[1] + toMWL)), B: Float32Array.from(cases.map((c) => c[2])) };
      const out = layerHeights({ n: 4, heights: h, values, label, landFloor: 2.23 });
      const names = sourceNames(h);
      cases.forEach(([lab, z, bv], k) => {
        const zHas = !Number.isNaN(z) && !(lab < 0 && z === 0);
        const want = lab > 0 ? (zHas ? "Z" : FLOOR) : zHas ? "Z" : !Number.isNaN(bv) ? "B" : FILLED;
        expect([k, names[out.source[k]]]).toEqual([k, want]);
        if (want === "Z") expect(out.heights[k]).toBe(Math.fround(z + toMWL));
        if (want === "B") expect(out.heights[k]).toBe(7);
      });
    }
  });
  it("refuses more sources than four bits hold", () => {
    expect(() => sourceNames({ water: Array.from({ length: 15 }, (_, k) => `s${k}`), land: [] })).toThrow(/at most 14/);
  });
});

describe("the layers file", () => {
  it("gives back every source code (0–15) and every canopy step (0–255), at odd and even lengths", () => {
    for (const N of [255, 256]) {
      const source = Uint8Array.from({ length: N }, (_, k) => k % 16), canopy = Uint8Array.from({ length: N }, (_, k) => k % 256);
      const back = unpackLayers(packLayers(source, canopy), N);
      expect([...back.source]).toEqual([...source]);
      expect([...back.canopy]).toEqual([...canopy].map((c) => c * CANOPY_SCALE));
    }
  });
  it("keeps the canopy on land only, in quarter metres, capped", () => {
    const label = Int8Array.from([1, 1, 1, -1, 0]);
    expect([...canopyBytes(Float32Array.from([0, 12.37, 99, 30, 30]), label)]).toEqual([0, 49, 255, 0, 0]);
  });
});

describe("sourceAgreement", () => {
  it("counts, off the band, the nodes a source puts above +1 m exactly where OSM says land", () => {
    const cls = { label: Int8Array.from([1, 1, -1, -1, 1, -1]), dist: Float32Array.from([50, 50, 50, 50, 5, 50]), band: 11 };
    const v = Float32Array.from([5, 0.5, -3, 4, 9, NaN]);
    expect(sourceAgreement(v, cls)).toEqual({ agree: 2, total: 4, share: 0.5 });
  });
});
