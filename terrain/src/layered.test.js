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
