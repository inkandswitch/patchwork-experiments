// Washing (wash.js): which pieces are swept together, and where they lie
// afterwards. Every case is finite and listed: rows of pieces with every
// pattern of gaps, and jumbles of every size up to two sets of dominoes
// under rngs that answer the extremes.
import { describe, it, expect } from "vitest";
import { cluster, colsFor, gap, jumble } from "./wash.js";

const sq = (x, z, h = 0.01) => ({ min: [x - h, 0, z - h], max: [x + h, 0.01, z + h] });

describe("gap", () => {
  it("is 0 for boxes that touch or overlap, else the plan distance between them", () => {
    expect(gap(sq(0, 0), sq(0.02, 0))).toBe(0);
    expect(gap(sq(0, 0), sq(0.01, 0.01))).toBe(0);
    expect(gap(sq(0, 0), sq(0.05, 0))).toBeCloseTo(0.03, 12);
    expect(gap(sq(0, 0), sq(0.05, 0.05))).toBeCloseTo(Math.hypot(0.03, 0.03), 12);
    // height plays no part
    expect(gap(sq(0, 0), { min: [0.03, 5, -0.01], max: [0.05, 6, 0.01] })).toBeCloseTo(0.02, 12);
  });
});

describe("cluster", () => {
  // five pieces in a row, each gap between neighbours either near (within the link) or far
  const LINK = 0.03;
  const patterns = [];
  for (let mask = 0; mask < 16; mask++) patterns.push([0, 1, 2, 3].map((i) => ((mask >> i) & 1 ? 0.025 : 0.04)));
  it(`covers ${patterns.length} patterns of gaps`, () => expect(patterns).toHaveLength(16));

  for (const gaps of patterns) {
    const boxes = {};
    let x = 0;
    for (let i = 0; i < 5; i++) {
      boxes[`p${i}`] = sq(x, 0);
      x += 0.02 + (gaps[i] ?? 0);
    }
    // what should be swept together: runs joined by near gaps
    const runOf = (i) => {
      let lo = i;
      while (lo > 0 && gaps[lo - 1] <= LINK) lo--;
      let hi = i;
      while (hi < 4 && gaps[hi] <= LINK) hi++;
      return Array.from({ length: hi - lo + 1 }, (_, k) => `p${lo + k}`);
    };
    it(`gaps ${gaps.map((g) => (g <= LINK ? "near" : "far")).join(", ")}: each piece sweeps exactly its run, the same set from any of it`, () => {
      for (let i = 0; i < 5; i++) {
        const got = cluster(boxes, `p${i}`, LINK);
        expect(got[0]).toBe(`p${i}`);
        expect([...got].sort()).toEqual(runOf(i));
        expect(new Set(got).size).toBe(got.length);
        // closed: nothing outside it is within the link of anything in it
        for (const out of Object.keys(boxes).filter((id) => !got.includes(id))) for (const inn of got) expect(gap(boxes[out], boxes[inn])).toBeGreaterThan(LINK);
        // the same set from every member
        for (const other of got) expect([...cluster(boxes, other, LINK)].sort()).toEqual([...got].sort());
      }
    });
  }

  it("is nothing for a piece that isn't there, and the piece alone with nothing near", () => {
    expect(cluster({ a: sq(0, 0) }, "b", 1)).toEqual([]);
    expect(cluster({ a: sq(0, 0), b: sq(1, 1) }, "a", 0.1)).toEqual(["a"]);
  });
});

describe("jumble", () => {
  const TILE = { reach: Math.hypot(0.0125, 0.025), cell: 0.06 };
  const RNGS = {
    zero: () => () => 0,
    top: () => () => 0.999999999,
    middle: () => () => 0.5,
    alternating: () => {
      let k = 0;
      return () => (k++ % 2 ? 0.999999999 : 0);
    },
    // a broken rng (NaN, out of range) is kept in [0, 1)
    broken: () => {
      let k = 0;
      return () => [NaN, -3, 7, Infinity][k++ % 4];
    },
  };

  for (const [name, rng] of Object.entries(RNGS)) {
    it(`(${name} rng) for 0 to 56 pieces: n spots, no two closer than two reaches, centred, turns in [0, 2π)`, () => {
      for (let n = 0; n <= 56; n++) {
        const spots = jumble(n, { centre: [0.1, -0.2], cell: TILE.cell, reach: TILE.reach, rng: rng() });
        expect(spots).toHaveLength(n);
        for (let i = 0; i < n; i++) {
          expect(spots[i].yaw).toBeGreaterThanOrEqual(0);
          expect(spots[i].yaw).toBeLessThan(2 * Math.PI);
          for (let j = i + 1; j < n; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThanOrEqual(2 * TILE.reach);
        }
        if (!n) continue;
        // within the grid's extent round the centre
        const cols = colsFor(n);
        const rows = Math.ceil(n / cols);
        for (const s of spots) {
          expect(Math.abs(s.x - 0.1)).toBeLessThanOrEqual((cols * TILE.cell) / 2 + 1e-9);
          expect(Math.abs(s.z + 0.2)).toBeLessThanOrEqual((rows * TILE.cell) / 2 + 1e-9);
        }
      }
    });
  }

  it("a cell smaller than the piece grows to fit it", () => {
    const spots = jumble(12, { cell: 0.01, reach: 0.03, rng: RNGS.alternating() });
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThanOrEqual(0.06);
  });

  it("lays a double-six set 7 across and 4 deep", () => {
    expect(colsFor(28)).toBe(7);
    expect(Math.ceil(28 / colsFor(28))).toBe(4);
    expect(colsFor(0)).toBe(1);
    expect(colsFor(1)).toBe(2);
  });
});
