// The veil's drawing (veil.js), over a finite set of shapes: a card lying
// flat, the same card on edge either way, a pawn, a cube, a wafer thinner
// than a decal, and bounds off the origin.
import { describe, it, expect } from "vitest";
import { parseGLB } from "../glb.js";
import { DECAL, DEFAULT_BOUNDS, cutRects, veilAxes, veilBounds, veilGLB, veilKey, veilParts } from "./veil.js";

const SHAPES = {
  card: { min: [-0.028, 0, -0.0435], max: [0.028, 0.0012, 0.0435] },
  cardOnEdgeX: { min: [0, -0.0435, -0.028], max: [0.0012, 0.0435, 0.028] },
  cardOnEdgeZ: { min: [-0.028, -0.0435, 0], max: [0.028, 0.0435, 0.0012] },
  pawn: { min: [-0.011, 0, -0.011], max: [0.011, 0.033, 0.011] },
  cube: { min: [0, 0, 0], max: [0.02, 0.02, 0.02] },
  wafer: { min: [-0.01, 0, -0.01], max: [0.01, 0.0003, 0.01] },
  offset: { min: [1.2, 0.7, -3.05], max: [1.26, 0.701, -2.96] },
  fallback: DEFAULT_BOUNDS,
};
const EPS = 1e-12;
const volume = (p) => [0, 1, 2].reduce((a, k) => a * (p.max[k] - p.min[k]), 1);
const overlap = (a, b) => [0, 1, 2].every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 1e-9);

describe("the veil, for every shape", () => {
  for (const [name, bounds] of Object.entries(SHAPES)) {
    const parts = veilParts(bounds);
    const { n, u, v } = veilAxes(bounds);

    it(`${name}: fills its bounds exactly, and never reaches outside them`, () => {
      for (const p of parts) for (let k = 0; k < 3; k++) {
        expect(p.min[k]).toBeGreaterThanOrEqual(bounds.min[k] - EPS);
        expect(p.max[k]).toBeLessThanOrEqual(bounds.max[k] + EPS);
        expect(p.max[k]).toBeGreaterThan(p.min[k]);
      }
      // no two pieces share space, and together they are the whole box: it is solid, with nothing to see through or into
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i], parts[j])).toBe(false);
      expect(parts.reduce((a, p) => a + volume(p), 0)).toBeCloseTo(volume(bounds), 12);
    });

    it(`${name}: the padlock is on the two largest faces, alike on both`, () => {
      const size = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
      expect(size[n]).toBeLessThanOrEqual(Math.min(size[u], size[v]) + EPS);
      const d = Math.min(DECAL, size[n] / 3);
      const decals = parts.filter((p) => p.name !== "core");
      const near = decals.filter((p) => Math.abs(p.max[n] - bounds.max[n]) < EPS);
      const far = decals.filter((p) => Math.abs(p.min[n] - bounds.min[n]) < EPS);
      expect(near.length).toBeGreaterThan(0);
      expect(near.length + far.length).toBe(decals.length);
      for (const p of decals) expect(p.max[n] - p.min[n]).toBeCloseTo(d, 12);
      // each side has the same pieces, mirrored across the face's u
      const cu = (bounds.min[u] + bounds.max[u]) / 2;
      const key = (p, flip) => [p.name, p.color, ...(flip ? [2 * cu - p.max[u], 2 * cu - p.min[u]] : [p.min[u], p.max[u]]), p.min[v], p.max[v]].map((x) => (typeof x === "number" ? x.toFixed(9) : x)).join("|");
      expect(far.map((p) => key(p, true)).sort()).toEqual(near.map((p) => key(p, false)).sort());
      for (const want of ["lock", "shackle", "keyhole", "frost"]) expect(near.some((p) => p.name === want)).toBe(true);
    });

    it(`${name}: its GLB is boxed by the bounds, so box and picking go by the hint`, () => {
      const glb = parseGLB(veilGLB(bounds));
      const acc = glb.json.accessors.filter((a) => a.type === "VEC3" && a.min && a.max && glb.json.meshes[0].primitives.some((p) => glb.json.accessors[p.attributes.POSITION] === a));
      const min = [0, 1, 2].map((k) => Math.min(...acc.map((a) => a.min[k])));
      const max = [0, 1, 2].map((k) => Math.max(...acc.map((a) => a.max[k])));
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeCloseTo(bounds.min[k], 6);
        expect(max[k]).toBeCloseTo(bounds.max[k], 6);
      }
    });
  }

  it("the lock stands up the face: along Y on an upright face, along Z on one lying flat", () => {
    expect(veilAxes(SHAPES.card)).toEqual({ n: 1, u: 0, v: 2 });
    expect(veilAxes(SHAPES.cardOnEdgeX)).toEqual({ n: 0, u: 2, v: 1 });
    expect(veilAxes(SHAPES.cardOnEdgeZ)).toEqual({ n: 2, u: 0, v: 1 });
    expect(veilAxes(SHAPES.cube).n).toBe(1);
    for (const b of Object.values(SHAPES)) {
      const { n, u, v } = veilAxes(b);
      expect([n, u, v].sort()).toEqual([0, 1, 2]);
      const parts = veilParts(b);
      const top = (name) => Math.max(...parts.filter((p) => p.name === name).map((p) => p.max[v]));
      expect(top("shackle")).toBeGreaterThan(top("lock"));
    }
  });

  it("says nothing but the bounds: the same bounds, the same bytes", () => {
    for (const b of Object.values(SHAPES)) expect(veilGLB({ min: [...b.min], max: [...b.max] })).toEqual(veilGLB(b));
    expect(veilKey(SHAPES.card)).not.toBe(veilKey(SHAPES.pawn));
  });

  it("bounds that aren't a box are no bounds", () => {
    for (const b of [null, {}, { min: [0, 0, 0] }, { min: [0, 0, 0], max: [1, 0, 1] }, { min: [0, 0, 0], max: [1, NaN, 1] }, { min: [1, 1, 1], max: [0, 0, 0] }]) expect(veilBounds(b)).toBeNull();
    expect(veilBounds({ min: ["0", 0, 0, 9], max: [1, 1, 1] })).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it("cutRects tiles a rectangle less its holes", () => {
    const area = (rs) => rs.reduce((a, [x0, z0, x1, z1]) => a + (x1 - x0) * (z1 - z0), 0);
    expect(area(cutRects([0, 0, 4, 4], [[1, 1, 2, 2]]))).toBeCloseTo(15);
    expect(area(cutRects([0, 0, 4, 4], [[1, 1, 3, 3], [2, 2, 5, 5]]))).toBeCloseTo(16 - 4 - 4 + 1);
    expect(cutRects([0, 0, 1, 1], [[-1, -1, 2, 2]])).toEqual([]);
  });
});
