// Every sector of E1M1, traced and triangulated, checked exactly: map
// coordinates are integers, so areas (doubled) and orientation tests are
// exact in floating point.
import { describe, expect, it } from "vitest";
import { loopArea2, sectorEdges, sectorPolygons, traceLoops, triangulateSector } from "./sectors.js";
import { readMap } from "./wad.js";
import { fixture } from "./test/fixture.js";

const map = readMap(fixture(), "E1M1");
const V = map.vertexes;
const all = map.sectors.map((_, s) => ({ s, ...triangulateSector(map, s) }));

/** Twice the area of a polygon (outlines less holes), exact. */
const area2 = (p) => Math.abs(loopArea2(p.outer, V)) - p.holes.reduce((a, h) => a + Math.abs(loopArea2(h, V)), 0);
const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
/** Do two segments cross at a point inside both (not merely touch)? */
const crosses = (p, q, a, b) => orient(p, q, a) * orient(p, q, b) < 0 && orient(a, b, p) * orient(a, b, q) < 0;
/** Do two triangles' interiors meet? Separating axes on the six edges; touching doesn't count. */
function overlap(t, u) {
  for (const [P, Q] of [[t, u], [u, t]]) {
    for (let i = 0; i < 3; i++) {
      const a = V[P[i]], b = V[P[(i + 1) % 3]];
      const n = [-(b.y - a.y), b.x - a.x];
      const proj = (T) => T.map((k) => n[0] * V[k].x + n[1] * V[k].y);
      const p = proj(P), q = proj(Q);
      if (Math.max(...p) <= Math.min(...q) || Math.max(...q) <= Math.min(...p)) return false;
    }
  }
  return true;
}
const inside = (x, y, loops) => {
  let n = 0;
  for (const loop of loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = V[loop[i]], b = V[loop[j]];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) n++;
    }
  return n % 2 === 1;
};

describe("every sector of E1M1", () => {
  it("is bounded by closed loops: no edge is left over", () => {
    expect(all.filter((r) => r.open.length).map((r) => r.s)).toEqual([]);
    // each edge's start is some edge's end, and the other way round, in every sector
    for (const { s } of all) {
      const edges = sectorEdges(map, s);
      const out = new Map(), into = new Map();
      for (const [a, b] of edges) out.set(a, (out.get(a) ?? 0) + 1), into.set(b, (into.get(b) ?? 0) + 1);
      for (const [v, n] of out) expect(into.get(v), `sector ${s} vertex ${v}`).toBe(n);
    }
  });

  it("is cut into triangles that cover it exactly: the same area, none overlapping, none outside", () => {
    const bad = [];
    for (const r of all) {
      const tri2 = r.triangles.reduce((a, t) => a + Math.abs(loopArea2(t, V)), 0);
      const want2 = r.polygons.reduce((a, p) => a + area2(p), 0);
      if (tri2 !== want2) bad.push({ s: r.s, why: "area", tri2, want2 });
      for (const t of r.triangles) if (loopArea2(t, V) >= 0) bad.push({ s: r.s, why: "not clockwise or degenerate", t });
      for (let i = 0; i < r.triangles.length; i++) for (let j = i + 1; j < r.triangles.length; j++) if (overlap(r.triangles[i], r.triangles[j])) bad.push({ s: r.s, why: "overlap", i, j });
      const loops = r.polygons.flatMap((p) => [p.outer, ...p.holes]);
      for (const t of r.triangles) {
        const c = [(V[t[0]].x + V[t[1]].x + V[t[2]].x) / 3, (V[t[0]].y + V[t[1]].y + V[t[2]].y) / 3];
        if (!inside(c[0], c[1], loops)) bad.push({ s: r.s, why: "outside", t });
        for (let k = 0; k < 3; k++) for (const loop of loops) for (let m = 0; m < loop.length; m++) if (crosses(V[t[k]], V[t[(k + 1) % 3]], V[loop[m]], V[loop[(m + 1) % loop.length]])) bad.push({ s: r.s, why: "crosses the boundary", t });
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("no two sectors overlap: every floor triangle of the map against every other", () => {
    const tris = all.flatMap((r) => r.triangles.map((t) => ({ s: r.s, t, box: [Math.min(...t.map((k) => V[k].x)), Math.min(...t.map((k) => V[k].y)), Math.max(...t.map((k) => V[k].x)), Math.max(...t.map((k) => V[k].y))] })));
    let pairs = 0;
    const bad = [];
    for (let i = 0; i < tris.length; i++)
      for (let j = i + 1; j < tris.length; j++) {
        const a = tris[i], b = tris[j];
        if (a.s === b.s || a.box[2] <= b.box[0] || b.box[2] <= a.box[0] || a.box[3] <= b.box[1] || b.box[3] <= a.box[1]) continue;
        pairs++;
        if (overlap(a.t, b.t)) bad.push([a.s, b.s]);
      }
    expect(bad).toEqual([]);
    expect(tris.length).toBe(1434);
    expect(pairs).toBeGreaterThan(1000);
  });

  it("measured: 14 sectors in several parts, 35 holes; none where loops meet at a vertex (those are cut below, and in all 100 Freedoom maps: README)", () => {
    expect(all.filter((r) => r.polygons.length > 1).length).toBe(14);
    expect(all.reduce((a, r) => a + r.polygons.reduce((b, p) => b + p.holes.length, 0), 0)).toBe(35);
    // non-manifold: a vertex with more than one edge leaving it, in one sector
    const pinched = all.filter(({ s }) => {
      const out = new Map();
      for (const [a] of sectorEdges(map, s)) out.set(a, (out.get(a) ?? 0) + 1);
      return [...out.values()].some((n) => n > 1);
    });
    expect(pinched.length).toBe(0);
  });
});

describe("loops, on small cases", () => {
  const verts = [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 0 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
  it("two squares touching at a corner are two loops, each clockwise", () => {
    // square A (0,0)-(2,2) and square C (2,2)-(4,4)… as edges with the region on the right
    const v = [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 2 }];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [4, 5], [5, 6], [6, 2]];
    const { loops, open } = traceLoops(edges, v);
    expect(open).toEqual([]);
    expect(loops).toHaveLength(2);
    for (const l of loops) expect(loopArea2(l, v)).toBe(-8);
  });
  it("a hole touching the outline at a corner: split there, cut right", () => {
    const m = {
      vertexes: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 6, y: 6 }, { x: 8, y: 6 }],
      sidedefs: [{ sector: 0 }, { sector: 1 }],
      // the pillar is a triangle (10,10)-(8,6)-(6,6) whose corner is the room's corner: one vertex, two loops through it
      linedefs: [[0, 1], [1, 2], [2, 3], [3, 0]].map(([v1, v2]) => ({ v1, v2, right: 0, left: -1 })).concat([[2, 5], [5, 4], [4, 2]].map(([v1, v2]) => ({ v1, v2, right: 1, left: 0 }))),
      sectors: [{}, {}],
    };
    const out = new Map();
    for (const [a] of sectorEdges(m, 0)) out.set(a, (out.get(a) ?? 0) + 1);
    expect(out.get(2)).toBe(2); // two edges leave the shared corner
    const t = triangulateSector(m, 0);
    expect(t.open).toEqual([]);
    const pillar = Math.abs(loopArea2([2, 5, 4], m.vertexes)) / 2;
    expect(t.area).toBe(100 - pillar);
    expect(t.triangles.reduce((a, tr) => a + Math.abs(loopArea2(tr, m.vertexes)) / 2, 0)).toBe(100 - pillar);
  });
  it("an unclosed boundary is reported, not invented", () => {
    const { loops, open } = traceLoops([[0, 1], [1, 2], [2, 3]], verts);
    expect(loops).toEqual([]);
    expect(open).toHaveLength(1);
  });
  it("a hole goes in the outline that holds it", () => {
    const m = {
      vertexes: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }],
      sidedefs: [{ sector: 0 }, { sector: 1 }],
      linedefs: [[0, 1], [1, 2], [2, 3], [3, 0]].map(([v1, v2]) => ({ v1, v2, right: 0, left: -1 })).concat([[4, 5], [5, 6], [6, 7], [7, 4]].map(([v1, v2]) => ({ v1, v2, right: 0, left: 1 }))),
      sectors: [{}, {}],
    };
    const { polygons } = sectorPolygons(m, 0);
    expect(polygons).toHaveLength(1);
    expect(polygons[0].holes).toHaveLength(1);
    const t = triangulateSector(m, 0);
    expect(t.area).toBe(96);
    expect(t.triangles.reduce((a, tr) => a + Math.abs(loopArea2(tr, m.vertexes)) / 2, 0)).toBe(96);
  });
});
