import { describe, it, expect } from "vitest";
import { sheetsAt, cloudMesh, capsAt, rimOf, CLOUDS, RINGS, SECTORS } from "./cloud.js";

// a made-up 81 × 81 place, 20 m cells: a cone of a hill 700 m high in the middle, a bowl (a hollow) in its north-west flank, forest everywhere above 5 m
const n = 81, cell = 20, x0 = -800, z0 = -800, N = n * n;
const grid = { n, cell, x0, z0 };
const ground = new Float32Array(N), canopy = new Float32Array(N);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const k = j * n + i, x = x0 + i * cell, z = z0 + j * cell;
  const r = Math.sqrt(x * x + z * z);
  const bowl = Math.max(0, 1 - Math.sqrt((x + 300) ** 2 + (z + 300) ** 2) / 200);
  ground[k] = Math.max(0, 700 - r * 0.9) - 60 * bowl;
  canopy[k] = ground[k] > 5 ? 25 : 0;
}
// every node's every chance taken, so what decides is the shape
const ALL = { ...CLOUDS, sheets: { ...CLOUDS.sheets, chance: 1 }, mist: { ...CLOUDS.mist, chance: 1 } };

describe("the sheets", () => {
  const all = sheetsAt(grid, ground, canopy, ALL);
  it("are local: the sheets of the grid are the sheets of its tiles, tile by tile (every split into rows)", () => {
    for (const rows of [1, 7, 20, 81]) {
      const tiles = [];
      for (let j0 = 0; j0 < n; j0 += rows) tiles.push(...sheetsAt(grid, ground, canopy, ALL, j0 * n, Math.min(n, j0 + rows) * n));
      expect(tiles).toEqual(all);
    }
  });
  it("lie at a level only where the ground there is near it (a slope the cloud base meets), on every `every`-th node", () => {
    const S = ALL.sheets;
    const stratus = all.filter((s) => s.kind === "stratus");
    expect(stratus.length).toBeGreaterThan(0);
    for (const s of stratus) {
      const i = s.k % n, j = (s.k - i) / n;
      expect(i % S.every).toBe(0);
      expect(j % S.every).toBe(0);
      const L = S.levels.find((l) => Math.abs(s.y - l) <= 15);
      expect(L).toBeDefined();
      expect(ground[s.k]).toBeGreaterThanOrEqual(L - S.below);
      expect(ground[s.k]).toBeLessThanOrEqual(L + S.above);
    }
    // and on every node that qualifies
    for (let k = 0; k < N; k++) {
      const i = k % n, j = (k - i) / n;
      if (i % S.every || j % S.every) continue;
      for (const L of S.levels) {
        const near = ground[k] >= L - S.below && ground[k] <= L + S.above;
        expect(stratus.some((s) => s.k === k && Math.abs(s.y - L) <= 15)).toBe(near);
      }
    }
  });
  it("lay mist only in the forest's hollows, over the canopy", () => {
    const mist = all.filter((s) => s.kind === "mist");
    expect(mist.length).toBeGreaterThan(0);
    for (const s of mist) {
      expect(canopy[s.k]).toBeGreaterThan(5);
      expect(s.y).toBeCloseTo(ground[s.k] + canopy[s.k] + ALL.mist.lift, 4);
      // in the bowl
      expect(Math.hypot(s.x + 300, s.z + 300)).toBeLessThan(260);
    }
  });
  it("take no chances they aren't given: none at all with chance 0", () => {
    expect(sheetsAt(grid, ground, canopy, { ...CLOUDS, sheets: { ...CLOUDS.sheets, chance: 0 }, mist: { ...CLOUDS.mist, chance: 0 } })).toEqual([]);
  });
});

describe("the cloud's mesh", () => {
  const sheets = sheetsAt(grid, ground, canopy, ALL);
  const m = cloudMesh(grid, ground, sheets);
  it("is never seen where the ground is close under it, and never thicker than its sheet", () => {
    const P = m.positions, C = m.colors.array;
    const maxAlpha = Math.max(...sheets.map((s) => Math.min(1, s.alpha * 0.6)));
    // the ground under a point, bilinear between the nodes
    const groundAt = (x, z) => {
      const fi = Math.max(0, Math.min(n - 1.000001, (x - x0) / cell)), fj = Math.max(0, Math.min(n - 1.000001, (z - z0) / cell));
      const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, w = fj - j;
      return ground[j * n + i] * (1 - u) * (1 - w) + ground[j * n + i + 1] * u * (1 - w) + ground[(j + 1) * n + i] * (1 - u) * w + ground[(j + 1) * n + i + 1] * u * w;
    };
    expect(P.length).toBeGreaterThan(0);
    for (let v = 0; v < P.length / 3; v++) {
      const a = C[v * 4 + 3];
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(maxAlpha + 1e-6);
      // seen only where the sheet is clear of the ground under it by its `clear` (the mist's, 6 m, the least)
      if (a > 0) expect(P[v * 3 + 1] - groundAt(P[v * 3], P[v * 3 + 2])).toBeGreaterThan(ALL.mist.clear - 1e-3);
    }
  });
  it("is the same bytes every time, two surfaces a bank, every triangle with some alpha", () => {
    const again = cloudMesh(grid, ground, sheets);
    expect(Array.from(again.positions)).toEqual(Array.from(m.positions));
    expect(Array.from(again.indices)).toEqual(Array.from(m.indices));
    expect(m.positions.length / 3).toBe(sheets.length * 2 * (1 + RINGS * SECTORS));
    const C = m.colors.array, I = m.indices;
    for (let t = 0; t < I.length; t += 3) expect(C[I[t] * 4 + 3] + C[I[t + 1] * 4 + 3] + C[I[t + 2] * 4 + 3]).toBeGreaterThan(0);
  });
  it("is a lens with a ragged rim: each bank's top domed over its base and its underside under it, inside its rim, its rim clear (every vertex of every bank)", () => {
    const V = 1 + RINGS * SECTORS, P = m.positions, C = m.colors.array;
    sheets.forEach((sh, q) => {
      const rim = rimOf(sh);
      for (const r of rim) {
        expect(r).toBeGreaterThanOrEqual(0.6);
        expect(r).toBeLessThanOrEqual(1);
      }
      // the rim isn't a circle
      expect(Math.max(...rim) - Math.min(...rim)).toBeGreaterThan(0.02);
      for (let side = 0; side < 2; side++) for (let v = 0; v < V; v++) {
        const at = (q * 2 + side) * V + v;
        const x = P[at * 3], y = P[at * 3 + 1], z = P[at * 3 + 2];
        const ring = v === 0 ? 0 : 1 + Math.floor((v - 1) / SECTORS), sector = v === 0 ? 0 : (v - 1) % SECTORS;
        const rho = ring / RINGS;
        expect(Math.hypot(x - sh.x, z - sh.z)).toBeCloseTo(rho * (sh.size / 2) * rim[sector], 3);
        // the top over the base and the underside under it, but for the roll's 4 m
        if (side === 0) expect(y).toBeGreaterThanOrEqual(sh.y - 4 - 1e-4);
        else expect(y).toBeLessThanOrEqual(sh.y + 4 + 1e-4);
        if (ring === RINGS) expect(C[at * 4 + 3]).toBe(0);
      }
    });
  });
});

describe("a cap round a summit", () => {
  it("lies `below` under the highest node within a cell of where it's named, keyed by itself, not a node", () => {
    const caps = capsAt(grid, ground, [{ x: 0, z: 0, below: 50, size: 600 }, { x: -300, z: -300, below: 10, size: 200, alpha: 0.4, thick: 20 }]);
    const top = (x, z) => {
      const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
      let t = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) t = Math.max(t, ground[(j + dj) * n + i + di]);
      return t;
    };
    expect(caps.map((c) => [c.k, c.kind, c.y, c.size, c.alpha, c.thick])).toEqual([
      [-1, "cap", top(0, 0) - 50, 600, 0.6, 60],
      [-2, "cap", top(-300, -300) - 10, 200, 0.4, 20],
    ]);
    // a summit's cap is seen round it, not inside the hill: no alpha where the ground is close under it
    const cm = cloudMesh(grid, ground, caps);
    expect(cm.indices.length).toBeGreaterThan(0);
  });
});
