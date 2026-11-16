import { describe, it, expect } from "vitest";
import { cutTriangle, cutShore, shoreSlabs, levelsOf } from "./shore.js";
import { bands } from "./palette.js";

const UKEE = { MLLW: -1.33, MHHW: 1.22, HHWLT: 1.93 };
// heights round three levels: below, on and between each, and above
const LEVELS = [0.5, 1, 3];
const H = [-1, 0.5, 0.7, 1, 2, 3, 4];
// a triangle's corners in the plane (x, z)
const XZ = [[0, 0], [0, 1], [1, 0]];
const signedArea = (pts) => {
  let s = 0;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) s += pts[b][0] * pts[a][1] - pts[a][0] * pts[b][1];
  return s / 2;
};
/** A piece's corners in the plane and their heights. */
const cornersOf = (piece, h) =>
  piece.corners.map((c) => {
    if ("v" in c) return { xz: XZ[c.v], h: h[c.v] };
    const s = (c.level - h[c.a]) / (h[c.b] - h[c.a]);
    return { xz: [XZ[c.a][0] + (XZ[c.b][0] - XZ[c.a][0]) * s, XZ[c.a][1] + (XZ[c.b][1] - XZ[c.a][1]) * s], h: c.level };
  });

describe("the shore's slabs", () => {
  it("are the bands above the water, the first reaching down under it, each above the one before, the wet ones rockweed and below", () => {
    const sl = shoreSlabs(UKEE);
    expect(sl[0].lo).toBe(-Infinity);
    for (let q = 1; q < sl.length; q++) expect(sl[q].lo).toBe(sl[q - 1].hi);
    expect(sl.map((s) => s.key)).toEqual(bands(UKEE).filter(([top]) => top > 0).map(([, k]) => k));
    expect(sl.map((s) => s.key)).toEqual(["rockweed", "barnacle", "lichen", "rock"]);
    expect(sl.map((s) => s.wet)).toEqual([true, false, false, false]);
    expect(levelsOf(sl)).toEqual(sl.map((s) => s.hi));
  });
});

describe("cutTriangle", () => {
  // every triangle with corner heights from H: 343 of them
  const cases = [];
  for (const a of H) for (const b of H) for (const c of H) cases.push([a, b, c]);
  it("cuts every triangle into pieces that tile it exactly, each inside its slab, in the triangle's winding (all 343 from the heights round three levels)", () => {
    for (const h of cases) {
      const pieces = cutTriangle(h, LEVELS);
      let area = 0;
      const slabs = new Set();
      for (const p of pieces) {
        expect(slabs.has(p.slab)).toBe(false);
        slabs.add(p.slab);
        const cs = cornersOf(p, h);
        const lo = p.slab === 0 ? -Infinity : LEVELS[p.slab - 1], hi = p.slab === LEVELS.length ? Infinity : LEVELS[p.slab];
        for (const c of cs) {
          expect(c.h).toBeGreaterThanOrEqual(lo);
          expect(c.h).toBeLessThanOrEqual(hi);
        }
        // the same way round as the triangle, and not empty
        const A = signedArea(cs.map((c) => c.xz));
        expect(Math.sign(A)).toBe(Math.sign(signedArea(XZ)));
        area += A;
      }
      expect(area).toBeCloseTo(signedArea(XZ), 12);
    }
  });
  it("makes a piece for exactly the slabs the triangle's heights reach into, and one for a flat triangle (all 343)", () => {
    for (const h of cases) {
      const lo = Math.min(...h), hi = Math.max(...h);
      const want = [];
      for (let q = 0; q <= LEVELS.length; q++) {
        const a = q === 0 ? -Infinity : LEVELS[q - 1], b = q === LEVELS.length ? Infinity : LEVELS[q];
        if (lo === hi ? lo >= a && lo < b : lo < b && hi > a) want.push(q);
      }
      expect(cutTriangle(h, LEVELS).map((p) => p.slab)).toEqual(want);
    }
  });
});

describe("cutShore", () => {
  // a 5 × 5 grid of nodes, two triangles a cell, heights falling to the water at the west: every way a cell can sit on the levels
  const n = 5;
  const hs = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs.push(-1.5 + i * 1.3 + ((i * 3 + j * 5) % 4) * 0.4);
  const positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 3);
  for (let k = 0; k < n * n; k++) {
    positions.set([(k % n) * 20, hs[k], Math.floor(k / n) * 20], k * 3);
    normals.set([0, 1, 0], k * 3);
    colors.set([k / 25, 0.5, 1 - k / 25], k * 3);
  }
  const triangles = [];
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if ((i + j) % 2) triangles.push(a, c, b, b, c, d);
    else triangles.push(a, c, d, a, d, b);
  }
  const ids = Array.from({ length: n * n }, (_, k) => k);
  const levels = [0.61, 1.22, 3.03, 4.93];
  const RED = [1, 0, 0], GREY = [0.25, 0.25, 0.25];
  // triangles in the western two columns are the shore
  const shore = (t) => [0, 1, 2].some((e) => triangles[t * 3 + e] % n < 2);
  // the slab below the first level red, the next grey, the rest the vertices' own
  const paint = (q) => (q === 0 ? RED : q === 1 ? GREY : null);
  const out = cutShore({ positions, normals, colors, triangles }, hs, ids, levels, shore, paint);
  const key = (v) => [0, 1, 2].map((e) => out.positions[v * 3 + e]).join(",");
  it("leaves no crack: every edge inside the grid is two triangles', point for point, and the area is the grid's", () => {
    const uses = new Map();
    let area = 0;
    for (let t = 0; t < out.triangles.length; t += 3) {
      const v = [out.triangles[t], out.triangles[t + 1], out.triangles[t + 2]];
      const p = v.map((x) => [out.positions[x * 3], out.positions[x * 3 + 2]]);
      area += -signedArea(p);
      for (let e = 0; e < 3; e++) {
        const k = [key(v[e]), key(v[(e + 1) % 3])].sort().join("|");
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
    }
    expect(area).toBeCloseTo(80 * 80, 6);
    for (const [k, u] of uses) {
      const pts = k.split("|").map((s) => s.split(",").map(Number));
      const onRim = pts.every(([x]) => x === 0) || pts.every(([x]) => x === 80) || pts.every(([, , z]) => z === 0) || pts.every(([, , z]) => z === 80);
      expect([k, u]).toEqual([k, onRim ? 1 : 2]);
    }
  });
  it("paints the shore's pieces their band, keeps the colours elsewhere exactly as they were, and moves no vertex off the ground", () => {
    expect(out.cut).toBeGreaterThan(0);
    let red = 0, grey = 0;
    for (let t = 0; t < out.triangles.length; t += 3) {
      const v = [out.triangles[t], out.triangles[t + 1], out.triangles[t + 2]];
      const cs = v.map((x) => [0, 1, 2].map((e) => out.colors[x * 3 + e]).join());
      const mid = v.reduce((s, x) => s + out.positions[x * 3 + 1], 0) / 3;
      const xs = v.map((x) => out.positions[x * 3]);
      if (cs.every((c) => c === RED.join())) {
        red++;
        expect(mid).toBeLessThanOrEqual(levels[0] + 1e-5);
        expect(xs.some((x) => x < 40)).toBe(true);
      }
      if (cs.every((c) => c === GREY.join())) {
        grey++;
        expect(mid).toBeGreaterThanOrEqual(levels[0] - 1e-5);
        expect(mid).toBeLessThanOrEqual(levels[1] + 1e-5);
      }
      for (const x of v) {
        const px = out.positions[x * 3], py = out.positions[x * 3 + 1], pz = out.positions[x * 3 + 2];
        // on the ground: at a node its height; on an edge between two, between theirs
        if (px % 20 === 0 && pz % 20 === 0) expect(py).toBe(Math.fround(hs[(pz / 20) * n + px / 20]));
        // away from the shore (nothing there is the shore's), the colour field as it was: linear in x and z
        if (xs.every((q) => q >= 40)) expect(out.colors[x * 3]).toBeCloseTo((pz / 4 + px / 20) / 25, 5);
      }
    }
    expect(red).toBeGreaterThan(0);
    expect(grey).toBeGreaterThan(0);
  });
  it("cuts nothing and changes nothing where no triangle spans a level", () => {
    const flat = cutShore({ positions, normals, colors, triangles }, hs.map(() => 7), ids, levels, shore, paint);
    expect(flat.cut).toBe(0);
    expect(Array.from(flat.triangles)).toEqual(triangles);
    expect(flat.added).toBe(0);
  });
});
