// Draw Dominoes (dominoes.js): the components of a real double-six set at
// real size, and the table each seat count lays out. Every count (2, 3, 4)
// and every tile is checked; nothing here is random but the table's own
// jumble, which takes the test's numbers.
import { describe, it, expect } from "vitest";
import { BONEYARD, FELT, PIPS, RACK, STANDING, TILE, TILE_TAGS, TILE_TOP, doubleSix, dominoes } from "./dominoes.js";
import { pieceGLB } from "../pieces.js";
import { tableLayout } from "../setup.js";
import { composeMatrix } from "../table/frame.js";
import { boxUnder } from "../table/stand.js";

const COUNTS = [2, 3, 4];
const gameOf = (n) => {
  const g = {};
  dominoes(n).fill(g);
  return g;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("a double-six set", () => {
  it("is the 28 tiles, each pair of ends from 0 to 6 once, 168 spots in all", () => {
    const set = doubleSix();
    expect(set).toHaveLength(28);
    expect(new Set(set.map(([a, b]) => `${a}-${b}`)).size).toBe(28);
    for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) expect(set.filter(([x, y]) => (x === a && y === b) || (x === b && y === a))).toHaveLength(1);
    expect(set.reduce((n, [a, b]) => n + a + b, 0)).toBe(168);
    expect(set.filter(([a, b]) => a === b)).toHaveLength(7);
  });

  it("has the usual spots for 0 to 6, every one inside its half, none touching another", () => {
    for (let v = 0; v <= 6; v++) {
      expect(PIPS[v]).toHaveLength(v);
      expect(new Set(PIPS[v].map((p) => p.join())).size).toBe(v);
      for (const [a, b] of PIPS[v]) expect([a, b].every((k) => [-1, 0, 1].includes(k))).toBe(true);
    }
  });

  for (const n of COUNTS) {
    const g = gameOf(n);
    const tiles = Object.entries(g.pieces).filter(([, p]) => p.hidden);

    it(`(${n} players) every tile is its own kind, one copy, kept in the boneyard, shown as one plain back`, () => {
      expect(tiles).toHaveLength(28);
      expect(new Set(tiles.map(([, p]) => p.name)).size).toBe(28);
      for (const [, p] of tiles) expect(p).toMatchObject({ count: 1, hidden: true, back: "back", deck: "boneyard" });
      expect(g.pieces.back).toMatchObject({ count: 0, tags: [...TILE_TAGS] });
      expect(g.pieces.back.parts.some((p) => p.name === "pip" || p.name === "bar")).toBe(false);
    });
  }

  it("is drawn at real size, about 50 × 25 × 10 mm, face and back in one box", () => {
    const g = gameOf(2);
    const back = pieceGLB(g.pieces.back).bounds;
    expect(near(back.max[0] - back.min[0], TILE.w)).toBe(true);
    expect(near(back.max[2] - back.min[2], TILE.l)).toBe(true);
    expect(near(back.min[1], 0) && near(back.max[1], TILE_TOP)).toBe(true);
    expect(TILE.l).toBeCloseTo(0.05, 6);
    expect(TILE.w).toBeCloseTo(0.025, 6);
    expect(TILE.t).toBeGreaterThan(0.008);
    expect(TILE.t).toBeLessThan(0.011);
    for (const [hi, lo] of doubleSix()) {
      const face = pieceGLB(g.pieces[`tile-${hi}-${lo}`]).bounds;
      for (let k = 0; k < 3; k++) {
        expect(near(face.min[k], back.min[k], 1e-5)).toBe(true);
        expect(near(face.max[k], back.max[k], 1e-5)).toBe(true);
      }
    }
  });

  it("puts each end's spots in its own half, with the bar and spinner between", () => {
    const g = gameOf(2);
    for (const [hi, lo] of doubleSix()) {
      const parts = g.pieces[`tile-${hi}-${lo}`].parts;
      const pips = parts.filter((p) => p.name === "pip");
      expect(pips.filter((p) => p.at[2] < 0)).toHaveLength(hi);
      expect(pips.filter((p) => p.at[2] > 0)).toHaveLength(lo);
      expect(parts.filter((p) => p.name === "bar")).toHaveLength(1);
      for (const p of pips) {
        const r = p.profile[1][0];
        expect(Math.abs(p.at[0]) + r).toBeLessThan(TILE.w / 2 - 0.001);
        expect(Math.abs(p.at[2]) + r).toBeLessThan(TILE.l / 2 - 0.001);
        expect(Math.abs(p.at[2]) - r).toBeGreaterThan(0.0011);
      }
    }
  });
});

describe("the table it lays out", () => {
  for (const n of COUNTS) {
    const g = gameOf(n);
    const racks = Object.values(g.pieces).filter((p) => p.zone);

    it(`(${n} players) a seat and a rack for each player, nothing dealt`, () => {
      expect(Object.keys(g.seats)).toEqual(Array.from({ length: n }, (_, i) => `p${i + 1}`));
      expect(racks.map((r) => r.zone.seat)).toEqual(Object.keys(g.seats));
      expect(g.decks.boneyard.deal).toBeUndefined();
      expect(g.decks.boneyard).toMatchObject({ faceDown: true, secure: true, spread: { cols: BONEYARD.cols, cell: BONEYARD.cell } });
    });

    it(`(${n} players) each rack faces its player: its +Z points out from the middle, its seat's view is behind it`, () => {
      for (const r of racks) {
        const m = composeMatrix({ position: [r.supply.at[0], 0, r.supply.at[1]], rotation: [0, r.supply.yaw, 0] });
        const out = [m[12], m[14]];
        const len = Math.hypot(...out);
        // +Z of the rack is its world direction m[8], m[10]
        expect(near(m[8], out[0] / len) && near(m[10], out[1] / len)).toBe(true);
        const cam = g.seats[r.zone.seat].camera.position;
        expect(Math.hypot(cam[0], cam[2])).toBeGreaterThan(len);
        expect(cam[0] * out[0] + cam[2] * out[1]).toBeGreaterThan(0);
      }
    });

    it(`(${n} players) racks lie off the felt and clear of one another`, () => {
      const boxes = racks.map((r) => boxUnder(composeMatrix({ position: [r.supply.at[0], 0, r.supply.at[1]], rotation: [0, r.supply.yaw, 0] }), { min: [-RACK.w / 2, 0, -RACK.d / 2], max: [RACK.w / 2, RACK.step, RACK.d / 2] }));
      const half = FELT.size / 2;
      for (const b of boxes) expect(b.min[0] >= half || b.max[0] <= -half || b.min[2] >= half || b.max[2] <= -half).toBe(true);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a.max[0] <= b.min[0] || b.max[0] <= a.min[0] || a.max[2] <= b.min[2] || b.max[2] <= a.min[2]).toBe(true);
      }
    });
  }

  it("a rack has 22 places, two rows of 11, each holding a tile standing on edge inside the rack's zone, facing its player", () => {
    const rack = gameOf(2).pieces.rack1;
    expect(rack.snapPoints).toHaveLength(22);
    const tile = { min: [-TILE.w / 2, 0, -TILE.l / 2], max: [TILE.w / 2, TILE_TOP, TILE.l / 2] };
    const R = composeMatrix({ rotation: STANDING });
    // the tile's face (+Y) turns to the rack's +Z; its length (+Z) along the rack
    expect([R[4], R[5], R[6]].map((v) => +v.toFixed(9) + 0)).toEqual([0, 0, 1]);
    expect([R[8], R[9], R[10]].map((v) => +v.toFixed(9) + 0)).toEqual([1, 0, 0]);
    const b = boxUnder(R, tile);
    for (const p of rack.snapPoints) {
      expect(p.rotation).toEqual([...STANDING]);
      expect(p.tags).toEqual([...TILE_TAGS]);
      // resting on the place: its footprint centred there, standing on it
      const lo = [p.position[0] - (b.max[0] - b.min[0]) / 2, p.position[1], p.position[2] - (b.max[2] - b.min[2]) / 2];
      const hi = [p.position[0] + (b.max[0] - b.min[0]) / 2, p.position[1] + (b.max[1] - b.min[1]), p.position[2] + (b.max[2] - b.min[2]) / 2];
      for (let k = 0; k < 3; k++) {
        expect(lo[k]).toBeGreaterThanOrEqual(rack.zone.min[k]);
        expect(hi[k]).toBeLessThanOrEqual(rack.zone.max[k]);
      }
    }
    // two tiles side by side don't touch, nor the rows
    const xs = [...new Set(rack.snapPoints.map((p) => p.position[0]))].sort((a, c) => a - c);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(TILE.l);
    const zs = [...new Set(rack.snapPoints.map((p) => p.position[2]))];
    expect(Math.abs(zs[0] - zs[1])).toBeGreaterThan(TILE.t);
  });

  for (const n of COUNTS) {
    it(`(${n} players) all 28 tiles start face down on the felt in the boneyard, none touching, none in a rack`, () => {
      const g = gameOf(n);
      const bounds = { min: [-TILE.w / 2, 0, -TILE.l / 2], max: [TILE.w / 2, TILE_TOP, TILE.l / 2] };
      const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds } });
      // a fixed run of numbers for the shuffle and the jumble: the extremes and the middle
      let k = 0;
      const rng = () => [0, 0.999999, 0.5][k++ % 3];
      const layout = tableLayout(g, { fileOf, rng });
      const tiles = Object.values(layout.objects).filter((o) => o.traits?.["tabletop.card"]);
      expect(tiles).toHaveLength(28);
      expect(layout.decks.boneyard.items).toHaveLength(28);
      expect(new Set(layout.decks.boneyard.items.map((i) => i.name)).size).toBe(28);
      const reach = Math.hypot(TILE.w / 2, TILE.l / 2);
      const half = FELT.size / 2;
      for (const t of tiles) {
        expect(t.transform.rotation[2]).toBeCloseTo(Math.PI, 9); // face down
        expect(t.transform.position[1]).toBeCloseTo(TILE_TOP, 9); // its underside on y = 0 once turned over
        expect(t.name).toBe("Domino");
        expect(t.tags).toEqual([...TILE_TAGS]);
        const [x, , z] = t.transform.position;
        expect(Math.abs(x) + reach).toBeLessThan(half);
        expect(Math.abs(z) + reach).toBeLessThan(half);
      }
      for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
        const [a, b] = [tiles[i].transform.position, tiles[j].transform.position];
        expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(2 * reach);
      }
    });
  }
});
