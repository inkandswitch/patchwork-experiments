// The water's exposure to the wind (exposure.js): made-up coasts (an open sea, a bay closed on three sides, a basin
// behind a breakwater, a straight coast) under the wind from each of the eight points, at every cell (finite).
import { describe, it, expect } from "vitest";
import { exposureGrid, exposureOf, exposureFor, bearingDir, EXPOSURE } from "./exposure.js";

const n = 64, size = 64 * 50; // 50 m cells, 3.2 km a side
const WINDS = [0, 45, 90, 135, 180, 225, 270, 315];
const COASTS = {
  "open sea": () => true,
  // land round the north, east and west, open to the south
  "a bay": (i, j) => !(j < 8 || i < 8 || i >= n - 8) || (j >= 8 && i >= 8 && i < n - 8),
  // a basin 550 m across in the middle, walled all round but for a 100 m gap in the south wall
  "a basin behind a breakwater": (i, j) => {
    const wall = ((i === 26 || i === 37) && j >= 26 && j <= 37) || ((j === 26 || j === 37) && i >= 26 && i <= 37);
    const gap = j === 37 && i >= 31 && i <= 32;
    return !wall || gap;
  },
  // land west of the 10th column
  "a straight coast": (i) => i >= 10,
};

describe("the water's exposure", () => {
  it("rises with the fetch, held to [0.15, 1] (every 10 m to 5 km)", () => {
    let last = 0;
    for (let f = 0; f <= 5000; f += 10) {
      const e = exposureOf(f);
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e).toBeGreaterThanOrEqual(EXPOSURE.min);
      expect(e).toBeLessThanOrEqual(1);
      last = e;
    }
    expect(exposureOf(EXPOSURE.reach)).toBe(1);
  });
  for (const [name, water] of Object.entries(COASTS)) for (const from of WINDS) {
    it(`is in [0.15, 1] at every cell of ${name}, wind from ${from}°`, () => {
      const e = exposureGrid(water, { n, size, from });
      for (const v of e) {
        expect(v).toBeGreaterThanOrEqual(EXPOSURE.min);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (name === "open sea") expect(e.every((v) => v === 1)).toBe(true);
    });
  }
  it("shelters the basin behind its breakwater from every wind (every cell inside under 0.5, but within 6 cells of its gap, where the sea comes through) while the open sea north of it is open to a north wind (a row near the grid's edge)", () => {
    for (const from of WINDS) {
      const e = exposureGrid(COASTS["a basin behind a breakwater"], { n, size, from });
      for (let j = 27; j <= 36; j++) for (let i = 27; i <= 36; i++) if (Math.hypot(i - 31.5, j - 37) > 6) expect(e[j * n + i]).toBeLessThan(0.5);
    }
    // a wind from the north: the sea north of the basin, 3 cells off the grid's top edge, has open water all the way upwind (off the grid is open sea)
    const e = exposureGrid(COASTS["a basin behind a breakwater"], { n, size, from: 0 });
    for (let i = 0; i < n; i++) expect(e[3 * n + i]).toBe(1);
  });
  it("rises with the distance off a straight coast, downwind of it (every row, wind from the west)", () => {
    const e = exposureGrid(COASTS["a straight coast"], { n, size, from: 270 });
    for (let j = 0; j < n; j++) for (let i = 11; i < n; i++) expect(e[j * n + i]).toBeGreaterThanOrEqual(e[j * n + i - 1] - 1e-6);
    // and the wind off the sea (from the east) leaves it open
    const off = exposureGrid(COASTS["a straight coast"], { n, size, from: 90 });
    for (let j = 0; j < n; j++) expect(off[j * n + 40]).toBe(1);
  });
  it("gives a land cell its most exposed water neighbour's, so a shore isn't dragged toward the land's", () => {
    const water = COASTS["a straight coast"];
    const e = exposureGrid(water, { n, size, from: 90 });
    for (let j = 1; j < n - 1; j++) expect(e[j * n + 9]).toBe(Math.max(e[(j - 1) * n + 10], e[j * n + 10], e[(j + 1) * n + 10]));
  });
  it("points north at −z and east at +x", () => {
    expect(bearingDir(0)[1]).toBeCloseTo(-1, 12);
    expect(bearingDir(90)[0]).toBeCloseTo(1, 12);
  });
  it("maps a terrain's place to the stage, turned and shifted (four quarter turns): its grid's corner is the origin, its axes u and v", () => {
    const t = { grid: { nx: 65, nz: 65, x0: -1600, z0: -1600, cell: 50 }, seaLevel: 0, heightAt: (x) => (x < -1000 ? 5 : -5) };
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
      // a turn about y by a: column-major, x axis (c, 0, −s), z axis (s, 0, c), shifted (100, 0, 200)
      const M = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 100, 0, 200, 1];
      const g = exposureFor(t, M, 270 - q * 90, { ...EXPOSURE, n: 32 });
      expect(g.n).toBe(32);
      expect(g.size).toBe(3200);
      expect(g.origin[0]).toBeCloseTo(100 + c * -1600 + s * -1600, 9);
      expect(g.origin[1]).toBeCloseTo(200 - s * -1600 + c * -1600, 9);
      // the land is along the place's west: under any turn, the wind that blows off it (the place's own west) shelters its lee
      expect(g.data[16 * 32 + 14]).toBeLessThan(255);
    }
  });
});
