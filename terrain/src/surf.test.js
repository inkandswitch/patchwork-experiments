import { describe, it, expect } from "vitest";
import { exposure, coastPieces, surfMesh, toward, SURF } from "./surf.js";

// a made-up 41 × 41 coast, 20 m cells: land east of x = 0 (a straight north–south shore facing west), a
// breakwater-like spit of land running west from the shore along the south, sheltering what lies north of it from
// the south-west
const n = 41, cell = 20, x0 = -400, z0 = -400;
const grid = { n, cell, x0, z0 };
const label = new Int8Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const x = x0 + i * cell, z = z0 + j * cell;
  label[j * n + i] = x > 0 || (z >= 200 && z <= 240 && x > -300) ? 1 : -1;
}
// the shore as OSM draws a coastline: land on the left going along it (north to south here: x east, z south)
const chains = [{ closed: false, ids: ["way/1"], points: [[0, -400], [0, 400]] }];

describe("exposure", () => {
  it("is the share of rays that get away over water: all of them straight out to sea, none into the land, and the spit's shelter in between", () => {
    // from the west (270°), at sea with nothing in the way
    expect(exposure(grid, label, -100, -300, 270, { reach: 250 })).toBe(1);
    // looking east into the land
    expect(exposure(grid, label, -100, 0, 90, { reach: 250, spread: 50 })).toBe(0);
    // just north of the spit, the swell from the south-west: some rays cross the spit, some don't
    const e = exposure(grid, label, -100, 180, 225, { reach: 400 });
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(1);
  });
  it("steps every ray the same way whatever the place (rays fanned evenly over ±spread)", () => {
    const [x, z] = toward(270);
    expect(x).toBeCloseTo(-1, 12);
    expect(z).toBeCloseTo(0, 12);
    const [x2, z2] = toward(0);
    expect(x2).toBeCloseTo(0, 12);
    expect(z2).toBeCloseTo(-1, 12);
  });
});

describe("the coast's pieces", () => {
  const pieces = coastPieces(chains, grid, label, 270, { reach: 300 });
  it("cuts the shore into pieces a cell long at most, each facing the sea (west here), none where the spit meets it", () => {
    // 40 pieces of 20 m, less the three whose middles (z 190, 210, 230) have the spit's land a cell out on both sides
    expect(pieces.length).toBe(37);
    expect(pieces.map((p) => (p.a[1] + p.b[1]) / 2).filter((z) => z > 180 && z < 240)).toEqual([]);
    for (const p of pieces) {
      expect(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1])).toBeLessThanOrEqual(cell + 1e-9);
      expect(p.sea[0]).toBeCloseTo(-1, 12);
      expect(p.sea[1]).toBeCloseTo(0, 12);
    }
  });
  it("puts the open shore at full exposure and the shore behind the spit's root lower", () => {
    const at = (z) => pieces.find((p) => p.a[1] <= z && p.b[1] > z);
    expect(at(-300).exposure).toBe(1);
    // where the spit meets the shore the shore isn't water on one side: no piece there
    expect(at(220)).toBe(undefined);
    expect(at(150).exposure).toBeLessThan(1);
  });
  it("gives a shore facing away from the swell none", () => {
    for (const p of coastPieces(chains, grid, label, 90, { reach: 300 })) expect(p.exposure).toBe(0);
  });
  it("is the union of its pieces' (each piece's answer is its own: the chain cut anywhere gives the same pieces)", () => {
    const halves = [{ closed: false, ids: ["way/1"], points: [[0, -400], [0, 0]] }, { closed: false, ids: ["way/1"], points: [[0, 0], [0, 400]] }];
    const strip = (ps) => ps.map(({ a, b, sea, exposure: e }) => ({ a, b, sea, e }));
    expect(strip(coastPieces(halves, grid, label, 270, { reach: 300 }))).toEqual(strip(pieces));
  });
});

describe("the foam", () => {
  const pieces = coastPieces(chains, grid, label, 270, { reach: 300 });
  const m = surfMesh(pieces);
  it("lies only along pieces exposed at least `min`, on the sea side, at the foam's height, every triangle facing up", () => {
    const exposed = pieces.filter((p) => p.exposure >= SURF.min);
    expect(m.pieces).toBe(exposed.length);
    expect(m.dashes).toBeGreaterThan(0);
    const P = m.positions;
    let flat = 0, spray = 0;
    for (let t = 0; t < P.length; t += 9) {
      const ys = [P[t + 1], P[t + 4], P[t + 7]];
      for (let v = t; v < t + 9; v += 3) {
        // from 1.5 m inside the shore to at most 4 + 12 × 1.3 + 4 + 8 + 4 m out
        expect(P[v]).toBeGreaterThanOrEqual(-35.6 - 1e-5);
        expect(P[v]).toBeLessThanOrEqual(1.5 + 1e-5);
      }
      if (ys.every((y) => Math.abs(y - SURF.y) < 1e-6)) {
        // the foam on the water: every triangle facing up
        flat++;
        const ux = P[t + 3] - P[t], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vz = P[t + 8] - P[t + 2];
        expect(uz * vx - ux * vz).toBeGreaterThanOrEqual(0);
      } else {
        // the spray: from just under the water to at most 0.5 + 1.5 m
        spray++;
        for (const y of ys) {
          expect(y).toBeGreaterThanOrEqual(-0.2 - 1e-6);
          expect(y).toBeLessThanOrEqual(2 + 1e-5);
        }
      }
    }
    expect(flat).toBeGreaterThan(0);
    expect(spray).toBeGreaterThan(0);
  });
  it("is white fading to the sea's grey-green: every colour between the two", async () => {
    const { hexToLinear } = await import("./glb.js");
    const white = hexToLinear(SURF.colour), sea = hexToLinear(SURF.fade);
    const C = m.colors;
    expect(C.length).toBe(m.positions.length);
    for (let v = 0; v < C.length; v += 3) {
      // one weight w for all three channels: colour = sea + (white − sea)·w, w in [0, 1]
      const w = (C[v] - sea[0]) / (white[0] - sea[0]);
      expect(w).toBeGreaterThanOrEqual(-1e-6);
      expect(w).toBeLessThanOrEqual(1 + 1e-6);
      for (let e = 1; e < 3; e++) expect(C[v + e]).toBeCloseTo(sea[e] + (white[e] - sea[e]) * w, 5);
    }
  });
  it("draws nothing where nothing is exposed, and the same bytes every time", () => {
    expect(surfMesh(pieces.map((p) => ({ ...p, exposure: 0 }))).positions.length).toBe(0);
    expect(Array.from(surfMesh(pieces).positions)).toEqual(Array.from(m.positions));
  });
});
