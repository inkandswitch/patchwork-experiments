import { tetBox, GMSH_EDGES } from "./tetbox.js";

const signed6 = (X, a, b, c, d) => {
  const u = [0, 1, 2].map((k) => X[b * 3 + k] - X[a * 3 + k]);
  const v = [0, 1, 2].map((k) => X[c * 3 + k] - X[a * 3 + k]);
  const w = [0, 1, 2].map((k) => X[d * 3 + k] - X[a * 3 + k]);
  return u[0] * (v[1] * w[2] - v[2] * w[1]) + u[1] * (v[2] * w[0] - v[0] * w[2]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
};

describe("tetBox", () => {
  for (const order of [1, 2]) {
    it(`order ${order}: six positive tetrahedra a cell, filling the box`, () => {
      const m = tetBox(2, 3, 1, [0.2, 0.3, 0.1], order);
      const per = order === 1 ? 4 : 10;
      expect(m.order).toBe(order);
      expect(m.tets.length / per).toBe(6 * 2 * 3 * 1);
      let V = 0;
      for (let o = 0; o < m.tets.length; o += per) {
        const v = signed6(m.nodes, m.tets[o], m.tets[o + 1], m.tets[o + 2], m.tets[o + 3]) / 6;
        expect(v).toBeGreaterThan(0);
        V += v;
      }
      expect(V).toBeCloseTo(0.2 * 0.3 * 0.1, 14);
    });
  }

  it("order 1 has only the grid's corners; order 2 adds one node an edge, at its midpoint", () => {
    const one = tetBox(2, 2, 2, [1, 1, 1], 1);
    expect(one.nodes.length / 3).toBe(27);
    const two = tetBox(2, 2, 2, [1, 1, 1], 2);
    const X = two.nodes;
    const seen = new Set();
    for (let o = 0; o < two.tets.length; o += 10)
      GMSH_EDGES.forEach(([a, b], e) => {
        const p = two.tets[o + a], q = two.tets[o + b], m = two.tets[o + 4 + e];
        seen.add(m);
        expect(m).toBeGreaterThanOrEqual(27);
        for (let k = 0; k < 3; k++) expect(X[m * 3 + k]).toBeCloseTo((X[p * 3 + k] + X[q * 3 + k]) / 2, 15);
      });
    // Euler on the solid ball: V − E + F − T = 1, with F = (4T + skin) / 2
    const T = 48, V = 27, F = (4 * T + two.skin.length / 3) / 2;
    expect(seen.size).toBe(V + F - T - 1);
    expect(two.nodes.length / 3).toBe(27 + seen.size);
  });

  it("its skin is every tetrahedron face no other shares, wound outward, on the right surface", () => {
    const m = tetBox(2, 1, 3, [0.4, 0.1, 0.3], 1);
    const count = new Map();
    const key = (a, b, c) => [a, b, c].sort((x, y) => x - y).join(",");
    for (let o = 0; o < m.tets.length; o += 4) {
      const t = [0, 1, 2, 3].map((k) => m.tets[o + k]);
      for (const [a, b, c] of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
        const k = key(t[a], t[b], t[c]);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    const boundary = [...count].filter(([, c]) => c === 1).map(([k]) => k).sort();
    const skin = [];
    for (let s = 0; s < m.skin.length; s += 3) skin.push(key(m.skin[s], m.skin[s + 1], m.skin[s + 2]));
    expect(skin.sort()).toEqual(boundary);
    expect(m.skin.length / 3).toBe(4 * (2 * 1 + 1 * 3 + 3 * 2));
    // outward: the normal points away from the centre; the surface is the face it faces
    const centre = [0.2, 0.05, 0.15];
    const X = m.nodes;
    for (let s = 0; s < m.skin.length / 3; s++) {
      const [a, b, c] = [0, 1, 2].map((k) => m.skin[s * 3 + k]);
      const e1 = [0, 1, 2].map((k) => X[b * 3 + k] - X[a * 3 + k]), e2 = [0, 1, 2].map((k) => X[c * 3 + k] - X[a * 3 + k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = [0, 1, 2].map((k) => X[a * 3 + k] - centre[k]);
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
      expect(m.skinSurface[s]).toBeGreaterThanOrEqual(1);
      expect(m.skinSurface[s]).toBeLessThanOrEqual(6);
    }
  });
});
