// The shore's profile for the water's mirror, over synthetic land: a step, a slope and a notched ridge,
// each turned to 8 azimuths, checked bin by bin against the march (finite, nothing random).
import { describe, it, expect } from "vitest";
import { horizonProfile, binDistance, azimuthDir, marchDistances, stillServes, SHORE, NO_LAND, NEAR_SHORE } from "./horizon.js";
import { canopyLayer } from "./build.js";
import { decodeTerrain, toBase64, int16ToBytes } from "./terrain-sample.js";

const { azimuths: A, bins: B } = SHORE;
const rs = marchDistances();
const at = (p, a, b) => [p[(b * A + a) * 4], p[(b * A + a) * 4 + 1], p[(b * A + a) * 4 + 2], p[(b * A + a) * 4 + 3]];
// the azimuth index nearest a direction `turn` eighths round
const azOf = (turn) => Math.round((turn / 8) * A - 0.5 + A) % A;

/** A field along a direction: f(s) where s is the distance along [cos t, sin t] (t the azimuth's), height 0 elsewhere. */
function along(a, f) {
  const [cx, cz] = azimuthDir(a);
  return (x, z) => {
    const s = x * cx + z * cz, w = -x * cz + z * cx;
    return Math.abs(w) < 200 ? f(s, w) : 0;
  };
}
/** What a bin must hold: the highest elevation from the mirror eye over the march's samples at or beyond its distance, that sample's distance (the nearest of equal highs), the nearest land's, and the highest within NEAR_SHORE of that. */
function expected(h, below, b) {
  let best = NO_LAND, far = 0, first = 0, top = NO_LAND;
  for (const r of rs) {
    if (r < binDistance(b)) continue;
    const y = h(r);
    if (!(y > 0)) continue;
    const e = Math.atan2(y + below, r);
    if (!first) first = r;
    if (r <= first + NEAR_SHORE && e > top) top = e;
    if (e > best) (best = e), (far = r / 1000);
  }
  return [best, far, first / 1000, top];
}

describe("the shore's profile (the mirror eye's horizon)", () => {
  const eye = [0, 3, 0];
  const below = 3;
  const cases = {
    "a step: 30 m of land from 800 m on": (s) => (s >= 800 ? 30 : 0),
    "a slope: rising 1 in 10 from 300 m, to 120 m": (s) => (s >= 300 ? Math.min(120, (s - 300) / 10) : 0),
    "a ridge 40 m high at 1.5 km, notched to 5 m in its middle": (s, w) => (s >= 1500 && s <= 1700 ? (Math.abs(w) < 40 ? 5 : 40) : 0),
  };
  for (const [name, f] of Object.entries(cases)) {
    it(`holds at every bin the highest land at or beyond it, and how far, along each of 8 azimuths: ${name}`, () => {
      for (let turn = 0; turn < 8; turn++) {
        const a = azOf(turn);
        const p = horizonProfile(along(a, f), eye);
        for (let b = 0; b < B; b++) {
          const [e, d, n, t] = at(p, a, b);
          const [we, wd, wn, wt] = expected((r) => f(r, 0), below, b);
          expect(t).toBeCloseTo(wt, 5);
          expect(t).toBeLessThanOrEqual(e + 1e-9);
          expect(e).toBeCloseTo(we, 5);
          expect(d).toBeCloseTo(wd, 5);
          expect(n).toBeCloseTo(wn, 5);
          if (we > NO_LAND) expect(n).toBeLessThanOrEqual(d + 1e-9);
          // never higher nearer than further: a bin holds its distance and beyond
          if (b > 0) expect(at(p, a, b - 1)[0]).toBeGreaterThanOrEqual(e);
        }
        // the opposite azimuth sees no land at all
        for (let b = 0; b < B; b++) expect(at(p, (a + A / 2) % A, b)[0]).toBe(NO_LAND);
      }
    });
  }
  it("sees the notch lower than the ridge either side of it (every one of 8 azimuths)", () => {
    for (let turn = 0; turn < 8; turn++) {
      const a = azOf(turn);
      // the ridge across the azimuth's line (no limit across), notched where the line meets it
      const [cx, cz] = azimuthDir(a);
      const h = (x, z) => {
        const s = x * cx + z * cz, w = -x * cz + z * cx;
        return s >= 1500 && s <= 1700 ? (Math.abs(w) < 60 ? 5 : 40) : 0;
      };
      const p = horizonProfile(h, eye);
      const mid = at(p, a, 0)[0], side = at(p, (a + 3) % A, 0)[0];
      expect(mid).toBeLessThan(side);
      expect(mid).toBeCloseTo(expected((r) => (r >= 1500 && r <= 1700 ? 5 : 0), below, 0)[0], 5);
    }
  });
  it("is nothing over open water, and nothing off the land's grid", () => {
    const p = horizonProfile(() => 0, eye);
    for (let q = 0; q < p.length; q += 4) expect(p[q]).toBe(NO_LAND);
    const off = horizonProfile(() => null, eye);
    for (let q = 0; q < off.length; q += 4) expect(off[q]).toBe(NO_LAND);
  });
  it("is made again only when the eye moves 25 m across or its height by a fifth (or 2 m)", () => {
    expect(stillServes(null, [0, 3, 0])).toBe(false);
    expect(stillServes([0, 3, 0], [24, 3, 0])).toBe(true);
    expect(stillServes([0, 3, 0], [26, 3, 0])).toBe(false);
    expect(stillServes([0, 3, 0], [0, 4.9, 0])).toBe(true);
    expect(stillServes([0, 3, 0], [0, 5.1, 0])).toBe(false);
    expect(stillServes([0, 100, 0], [0, 119, 0])).toBe(true);
    expect(stillServes([0, 100, 0], [0, 126, 0])).toBe(false);
  });
});

describe("the canopy in extras.terrain (a skyline)", () => {
  it("keeps, at every coarse node, the most canopy within half a stride of it, and the sampler adds it to the ground (every node of a 33 × 33 grid)", () => {
    const n = 33, cell = 8, grid = { n, cell, x0: -100, z0: -50 };
    const canopy = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) canopy[k] = (k * 7) % 31;
    const layer = canopyLayer(grid, canopy);
    expect(layer.grid.cell).toBe(32);
    const m = layer.grid.nx;
    expect(m).toBe(9);
    const heights = new Int16Array(n * n).fill(100);
    const t = decodeTerrain({ version: 1, grid: { nx: n, nz: n, x0: grid.x0, z0: grid.z0, cell }, heights: { encoding: "int16le-base64", scale: 0.1, offset: 0, data: toBase64(int16ToBytes(heights)) }, canopy: layer });
    for (let J = 0; J < m; J++) for (let I = 0; I < m; I++) {
      let most = 0;
      for (let j = Math.max(0, J * 4 - 2); j <= Math.min(n - 1, J * 4 + 2); j++) for (let i = Math.max(0, I * 4 - 2); i <= Math.min(n - 1, I * 4 + 2); i++) most = Math.max(most, canopy[j * n + i]);
      expect(t.surfaceAt(grid.x0 + I * 32, grid.z0 + J * 32)).toBeCloseTo(10 + most, 6);
    }
    expect(t.surfaceAt(-1000, 0)).toBe(null);
  });
});

import { shoreProfile } from "./place.js";
describe("the shore's profile for a terrain placed in the stage", () => {
  it("is the land's own, its azimuths turned with it and its eye moved with it (a quarter turn and a shift, every bin of 8 azimuths)", () => {
    // a ridge east of the land's origin, 50 m high from 600 to 900 m
    const t = { seaLevel: 0, surfaceAt: (x, z) => (x >= 600 && x <= 900 && Math.abs(z) < 300 ? 50 : 0) };
    const own = shoreProfile(t, null, [0, 4, 0]);
    // the land turned a quarter (its +x along the stage's +z) and shifted by (100, 2, −40)
    const M = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 100, 2, -40, 1];
    const placed = shoreProfile(t, M, [100, 6, -40]);
    for (let turn = 0; turn < 8; turn++) {
      const a = (turn * A) / 8;
      for (let b = 0; b < B; b++) {
        expect(at(placed, (a + A / 4) % A, b)[0]).toBeCloseTo(at(own, a, b)[0], 6);
        expect(at(placed, (a + A / 4) % A, b)[1]).toBeCloseTo(at(own, a, b)[1], 6);
        expect(at(placed, (a + A / 4) % A, b)[2]).toBeCloseTo(at(own, a, b)[2], 6);
        expect(at(placed, (a + A / 4) % A, b)[3]).toBeCloseTo(at(own, a, b)[3], 6);
      }
    }
    // and the ridge is there, due "east" of the land: along the stage's +z
    expect(at(placed, A / 4, 0)[0]).toBeGreaterThan(0);
  });
});
