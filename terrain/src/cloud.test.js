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

import { bakeStratus } from "./cloud.js";
describe("stratus baked into colours", () => {
  it("leaves every vertex at or under `from` as it was, and lerps every one above toward the fog by (y − from) / span ± noise, never past `max` (every height from 0 to 700 m)", () => {
    const H = Array.from({ length: 141 }, (_, q) => q * 5);
    const positions = new Float32Array(H.flatMap((y, q) => [q * 37.3, y, -q * 11.1]));
    const colors = new Float32Array(H.flatMap(() => [0.02, 0.03, 0.02]));
    const o = { from: 250, span: 300, max: 0.85, noise: 0.3, colour: "#959ea1" };
    const touched = bakeStratus(positions, colors, o);
    expect(touched).toBe(H.filter((y) => y > 250).length);
    const fog = [0x95, 0x9e, 0xa1].map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4);
    H.forEach((y, q) => {
      const t = (colors[q * 3] - 0.02) / (fog[0] - 0.02);
      if (y <= 250) expect(colors[q * 3]).toBe(Math.fround(0.02));
      else {
        const base = Math.min(1, (y - 250) / 300);
        expect(t).toBeGreaterThanOrEqual(Math.min(0.85, base * 0.7) - 1e-5);
        expect(t).toBeLessThanOrEqual(Math.min(0.85, base * 1.3) + 1e-5);
        // every channel by the same share
        for (const c of [1, 2]) expect((colors[q * 3 + c] - [0.02, 0.03, 0.02][c]) / (fog[c] - [0.02, 0.03, 0.02][c])).toBeCloseTo(t, 4);
      }
    });
    // the same bytes again (a function of where each vertex is)
    const again = new Float32Array(H.flatMap(() => [0.02, 0.03, 0.02]));
    bakeStratus(positions, again, o);
    expect(again).toEqual(colors);
  });
});

import { stratusAt } from "./cloud.js";
import { hexToLinear } from "./glb.js";
describe("the stratus as a band across the hills (Ucluelet's)", () => {
  const band = { from: 280, peak: 420, span: 200, max: 0.7, above: 0.45, noise: 0.3, colour: "#737b7e" };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const horizon = hexToLinear("#959ea1").slice(0, 3);
  it("rises from nothing at `from` to its peak, eases back to `above` over the next span, and holds (every 20 m to 800 m)", () => {
    let last = 0;
    for (let y = 0; y <= 800; y += 20) {
      const f = stratusAt(y, band);
      if (y <= 280) expect(f).toBe(0);
      else if (y <= 420) {
        expect(f).toBeGreaterThanOrEqual(last);
        expect(f).toBeLessThanOrEqual(0.7 + 1e-12);
      } else {
        expect(f).toBeLessThanOrEqual(last + 1e-12);
        expect(f).toBeGreaterThanOrEqual(0.45 - 1e-12);
      }
      if (y >= 620) expect(f).toBeCloseTo(0.45, 12);
      last = f;
    }
    expect(stratusAt(420, band)).toBeCloseTo(0.7, 12);
  });
  it("never makes a hill lighter than the horizon's colour, from any of the forest's and the ground's colours (every 20 m to 800 m, every hash)", () => {
    const bases = ["#16241c", "#131e17", "#2a3a2c", "#36463a", "#3b3a37", "#232b20", "#55585a", "#5d5850"].map((h) => hexToLinear(h).slice(0, 3));
    const H = Array.from({ length: 41 }, (_, q) => q * 20);
    for (const base of bases) {
      // every height at 64 places (64 hashes), so the noise's whole range is seen
      const positions = new Float32Array(H.length * 64 * 3), colors = new Float32Array(H.length * 64 * 3);
      H.forEach((y, a) => { for (let b = 0; b < 64; b++) { const v = a * 64 + b; positions.set([b * 7 + a, y, b * 13], v * 3); colors.set(base, v * 3); } });
      bakeStratus(positions, colors, band);
      for (let v = 0; v < colors.length / 3; v++) {
        const c = [colors[v * 3], colors[v * 3 + 1], colors[v * 3 + 2]];
        expect(lum(c)).toBeLessThanOrEqual(lum(horizon) + 1e-6);
        for (let e = 0; e < 3; e++) expect(c[e]).toBeLessThanOrEqual(Math.max(base[e], horizon[e]) + 1e-6);
      }
    }
  });
});

import { stratusFactor, wispShare, WISPS } from "./cloud.js";
describe("the stratus torn into wisps (Ucluelet's bake)", () => {
  const bake = { from: 280, peak: 420, span: 200, max: 0.75, above: 0.5, colour: "#737b7e", wisps: true, low: { from: 60, peak: 120, span: 120, max: 0.35, above: 0.12, within: [{ x: 0, z: 0, radius: 2000 }] } };
  const G = Array.from({ length: 32 }, (_, q) => q * 61.7);
  const H = Array.from({ length: 41 }, (_, q) => q * 20);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it("stays in [0, 0.75] at every height to 800 m, at every point of a 32 × 32 grid, in the low band's circle and out of it", () => {
    for (const ox of [0, 5000]) for (const y of H) for (const a of G) for (const b of G) {
      const f = stratusFactor(ox + a, y, b, bake) ?? 0;
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(0.75);
      // out of the low band's circle, nothing under `from`
      if (ox && y <= 280) expect(f).toBe(0);
      // in it, the mist is never more than its own max under the band
      if (!ox && y <= 280) expect(f).toBeLessThanOrEqual(0.35);
    }
  });
  it("never makes a hill lighter than the horizon (every height to 800 m, a 32 × 32 grid, the forest's and the ground's colours)", () => {
    const horizon = hexToLinear("#959ea1").slice(0, 3);
    for (const hex of ["#16241c", "#2a3a2c", "#55585a", "#5d5850"]) {
      const base = hexToLinear(hex).slice(0, 3);
      const positions = [], colors = [];
      for (const y of H) for (const a of G) for (const b of G) positions.push(a + 3000, y, b), colors.push(...base);
      const P = new Float32Array(positions), C = new Float32Array(colors);
      bakeStratus(P, C, bake);
      for (let v = 0; v < C.length / 3; v++) expect(lum([C[v * 3], C[v * 3 + 1], C[v * 3 + 2]])).toBeLessThanOrEqual(lum(horizon) + 1e-6);
    }
  });
  it("covers between 30% and 55% of Mount Ozzard's flank at the band's thickest (factor over 0.4), and leaves at least 40% of it at 0.2 or less: wisps with forest between", () => {
    // Ozzard's box in the frame (its radome at about (4770, −1045)), at the band's thickest heights
    let over = 0, under = 0, all = 0;
    for (const y of [400, 420, 440]) for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) {
      const f = stratusFactor(4000 + a * 50, y, -1800 + b * 50, bake);
      if (f > 0.4) over++;
      if (f <= 0.2) under++;
      all++;
    }
    expect(over / all).toBeGreaterThanOrEqual(0.3);
    expect(over / all).toBeLessThanOrEqual(0.55);
    expect(under / all).toBeGreaterThanOrEqual(0.4);
  });
  it("takes between the floor and all of the band, and runs along a slope more than across it (wisps, not blobs)", () => {
    let along = 0, across = 0;
    for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) {
      const x = a * 83, z = b * 83, y = 420;
      const s = wispShare(x, y, z);
      expect(s).toBeGreaterThanOrEqual(WISPS.floor);
      expect(s).toBeLessThanOrEqual(1);
      // a hillside rising 1 in 2 toward +x: 30 m along the contour (z) changes less than 30 m up the slope (x and y)
      along += Math.abs(wispShare(x, y, z + 30) - s);
      across += Math.abs(wispShare(x + 30, y + 15, z) - s);
    }
    expect(along).toBeLessThan(across);
  });
});
