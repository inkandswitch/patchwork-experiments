import { describe, it, expect } from "vitest";
import { dedupePolyline, simplifyPolyline, linesMesh, tubesMesh, sliceGrid, coarseMask, capPoints } from "./geometry.js";

const arc = (n, r = 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * i) / (n - 1);
    return [r * Math.cos(a), r * Math.sin(a), 0];
  });

describe("polylines", () => {
  it("dedupe drops repeated points and keeps fields aligned", () => {
    const d = dedupePolyline([[0, 0, 0], [0, 0, 0], [1, 0, 0]], { s: [1, 2, 3] });
    expect(d.points).toHaveLength(2);
    expect(d.fields.s).toEqual([1, 3]);
  });

  it("simplify keeps straight runs sparse and curves dense", () => {
    const straight = Array.from({ length: 101 }, (_, i) => [i * 0.1, 0, 0]);
    const s = simplifyPolyline(straight, { v: straight.map((p) => p[0]) }, { maxSegment: 1 });
    expect(s.points.length).toBeLessThanOrEqual(12);
    expect(s.points[0]).toEqual([0, 0, 0]);
    expect(s.points.at(-1)[0]).toBeCloseTo(10);
    expect(s.fields.v).toEqual(s.points.map((p) => p[0]));
    // a half circle with 2° tolerance needs on the order of 90 points, not 5
    const c = simplifyPolyline(arc(1000), {}, { maxTurnDeg: 2, maxSegment: 100 });
    expect(c.points.length).toBeGreaterThan(30);
    expect(c.points.length).toBeLessThan(200);
    // no chord strays far from the arc
    for (const p of c.points) expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 6);
  });
});

describe("meshes", () => {
  const lines = [{ points: arc(10), fields: { s: Array.from({ length: 10 }, (_, i) => i) } }];

  it("linesMesh emits index pairs per segment", () => {
    const m = linesMesh(lines, ["s"]);
    expect(m.indices).toHaveLength(18);
    expect(m.fields.s[9]).toBe(9);
  });

  it("tubes have outward unit normals at the radius", () => {
    const r = 0.05;
    const m = tubesMesh(lines, ["s"], { radius: r, sides: 6 });
    expect(m.positions.length / 3).toBe(60);
    expect(m.indices.length).toBe(9 * 6 * 6);
    for (let v = 0; v < 60; v++) {
      const ring = Math.floor(v / 6);
      const c = lines[0].points[ring];
      const off = [0, 1, 2].map((k) => m.positions[v * 3 + k] - c[k]);
      expect(Math.hypot(...off)).toBeCloseTo(r, 5);
      const n = [0, 1, 2].map((k) => m.normals[v * 3 + k]);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(off[k] / r, 4);
      expect(m.fields.s[v]).toBe(ring);
    }
    // triangle winding agrees with the outward normals
    const P = (i) => [0, 1, 2].map((k) => m.positions[i * 3 + k]);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [P(m.indices[t]), P(m.indices[t + 1]), P(m.indices[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const na = [0, 1, 2].map((k) => m.normals[m.indices[t] * 3 + k]);
      expect(n[0] * na[0] + n[1] * na[1] + n[2] * na[2]).toBeGreaterThan(0);
    }
  });

  it("sliceGrid is counter-clockwise from above and drops masked cells", () => {
    const domain = { min: [0, 0, 0], max: [4, 2, 1] };
    const g = sliceGrid(domain, 0.5, 4, ["v"], (x, y) => ({ values: { v: x + y }, masked: x > 1.5 && x < 2.5 }));
    expect([g.nx, g.ny]).toEqual([4, 2]);
    // cells touching x = 2 are masked: 2 columns × 2 rows gone
    expect(g.indices.length / 6).toBe(8 - 4);
    const P = (i) => [g.positions[i * 3], g.positions[i * 3 + 1]];
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [P(g.indices[t]), P(g.indices[t + 1]), P(g.indices[t + 2])];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
  });

  it("coarseMask matches the full mask on a disc, with fewer tests", () => {
    const inDisc = (i, j) => Math.hypot(i - 40, j - 22) < 12.3;
    for (const [nx, ny] of [[80, 44], [81, 45]]) {
      let calls = 0;
      const m = coarseMask(nx, ny, 3, (i, j) => (calls++, inDisc(i, j)));
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) expect(m[j * (nx + 1) + i]).toBe(inDisc(i, j) ? 1 : 0);
      expect(calls).toBeLessThan(0.4 * (nx + 1) * (ny + 1));
    }
    let calls = 0;
    coarseMask(10, 5, 1, () => (calls++, false));
    expect(calls).toBe(66);
  });

  it("sliceGrid takes a whole mask when given one", () => {
    const domain = { min: [0, 0, 0], max: [4, 2, 1] };
    const g = sliceGrid(domain, 0.5, 4, ["v"], () => ({ values: { v: 0 }, masked: true }), {
      mask: (nx, ny, xAt) => coarseMask(nx, ny, 2, (i) => xAt(i) === 2),
    });
    expect(g.indices.length / 6).toBe(8 - 4);
  });

  it("sliceGrid clips cells along a curved mask edge instead of dropping them", () => {
    // a disc of radius 0.7 in a 4 × 2 domain on a coarse 20-cell grid
    const domain = { min: [0, 0, 0], max: [4, 2, 1] };
    const R = 0.7;
    const inDisc = (x, y) => Math.hypot(x - 2, y - 1) < R;
    const sample = (x, y) => ({ values: { v: x }, masked: inDisc(x, y) });
    const edge = (ax, ay, bx, by) => {
      let lo = 0, hi = 1;
      for (let n = 0; n < 20; n++) { const t = (lo + hi) / 2; if (inDisc(ax + t * (bx - ax), ay + t * (by - ay))) hi = t; else lo = t; }
      return (lo + hi) / 2;
    };
    const area = (g) => {
      let A = 0;
      const P = (i) => [g.positions[i * 3], g.positions[i * 3 + 1]];
      for (let t = 0; t < g.indices.length; t += 3) {
        const [a, b, c] = [P(g.indices[t]), P(g.indices[t + 1]), P(g.indices[t + 2])];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        expect(cr).toBeGreaterThan(0); // still counter-clockwise from above
        A += cr / 2;
      }
      return A;
    };
    const exact = 8 - Math.PI * R * R;
    const stair = sliceGrid(domain, 0.5, 20, ["v"], sample);
    const clipped = sliceGrid(domain, 0.5, 20, ["v"], sample, { edge });
    const stairErr = Math.abs(area(stair) - exact);
    const clipErr = Math.abs(area(clipped) - exact); // what's left is the chords' sag
    expect(stairErr).toBeGreaterThan(0.15);
    expect(clipErr).toBeLessThan(0.03);
    expect(clipErr).toBeLessThan(stairErr / 8);
    // every new vertex sits on the circle, carries its sampled field, and is unmasked
    for (let v = clipped.gridVertices; v < clipped.positions.length / 3; v++) {
      const x = clipped.positions[v * 3], y = clipped.positions[v * 3 + 1];
      expect(Math.abs(Math.hypot(x - 2, y - 1) - R)).toBeLessThan(1e-3);
      expect(clipped.fields.v[v]).toBeCloseTo(x, 5);
      expect(clipped.masked[v]).toBe(0);
    }
    // a crossing is shared by the two cells either side of its edge
    const used = new Map();
    for (const i of clipped.indices) if (i >= clipped.gridVertices) used.set(i, (used.get(i) ?? 0) + 1);
    expect([...used.values()].every((n) => n >= 2)).toBe(true);
  });

  it("capPoints thins lines to a budget, keeping their ends and fields aligned", () => {
    const line = (n) => ({ points: Array.from({ length: n }, (_, i) => [i, 0, 0]), fields: { s: Array.from({ length: n }, (_, i) => i) } });
    const lines = [line(100), line(50), line(3)];
    expect(capPoints(lines, 1000)).toBe(lines);
    const c = capPoints(lines, 60);
    expect(c.reduce((a, l) => a + l.points.length, 0)).toBeLessThanOrEqual(60);
    for (const l of c) {
      expect(l.points.length).toBeGreaterThanOrEqual(2);
      expect(l.points.map((p) => p[0])).toEqual(l.fields.s);
    }
    expect(c[0].points[0][0]).toBe(0);
    expect(c[0].points.at(-1)[0]).toBe(99);
  });
});
