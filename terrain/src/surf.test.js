import { describe, it, expect } from "vitest";
import { exposure, coastPieces, surfMesh, toward, SURF, endOf, widthAt, reefPatches, boulders, BOULDER } from "./surf.js";

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
    expect(m.runs).toBeGreaterThan(0);
    const P = m.positions;
    let flat = 0, spray = 0;
    for (let t = 0; t < P.length; t += 9) {
      const ys = [P[t + 1], P[t + 4], P[t + 7]];
      for (let v = t; v < t + 9; v += 3) {
        // from 1.5 m inside the shore to at most 12 (the widest foam) + 8 + 4 (the lace) m out (a straight shore: no bend to widen it)
        expect(P[v]).toBeGreaterThanOrEqual(-24 - 1e-5);
        expect(P[v]).toBeLessThanOrEqual(1.5 + 1e-5);
      }
      if (ys.every((y) => Math.abs(y - SURF.y) < 1e-6)) {
        // the foam on the water: every triangle facing up
        flat++;
        const ux = P[t + 3] - P[t], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vz = P[t + 8] - P[t + 2];
        expect(uz * vx - ux * vz).toBeGreaterThanOrEqual(0);
      } else {
        // the spray: from just under the water to at most 0.4 + 1.6 m
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

describe("the foam is one ribbon along the shore, not dashes", () => {
  const pieces = coastPieces(chains, grid, label, 270, { reach: 300 });
  it("knows each piece's neighbours along the coast (none across the spit, where no piece is)", () => {
    for (let q = 0; q < pieces.length; q++) {
      const p = pieces[q];
      const before = pieces.find((o) => o.b[1] === p.a[1]), after = pieces.find((o) => o.a[1] === p.b[1]);
      expect(p.prev).toEqual(before ? { exposure: before.exposure, sea: before.sea } : null);
      expect(p.next).toEqual(after ? { exposure: after.exposure, sea: after.sea } : null);
    }
  });
  it("gives both pieces at a shared end the same end (point, direction, bend, exposure, width): every shared end", () => {
    let shared = 0;
    for (const p of pieces) {
      const after = pieces.find((o) => o.a[1] === p.b[1]);
      if (!after || p.exposure < SURF.min || after.exposure < SURF.min) continue;
      shared++;
      const B = endOf(p, "b"), A = endOf(after, "a");
      expect(B).toEqual(A);
      expect(widthAt(B)).toBe(widthAt(A));
      expect(widthAt(B)).toBeGreaterThanOrEqual(2);
      expect(widthAt(B)).toBeLessThanOrEqual(12);
    }
    expect(shared).toBeGreaterThan(10);
  });
  it("tapers to nothing at a run's ends (where the next piece isn't exposed enough, or there is none)", () => {
    let tips = 0;
    for (const p of pieces) {
      if (p.exposure < SURF.min) continue;
      for (const end of ["a", "b"]) {
        const other = end === "a" ? p.prev : p.next;
        if (other && other.exposure >= SURF.min) continue;
        tips++;
        expect(widthAt(endOf(p, end))).toBe(0);
      }
    }
    expect(tips).toBeGreaterThan(0);
  });
  it("runs round a closed ring's join: its last piece's neighbour is its first", () => {
    // a square island in open water, its ring as OSM draws a coastline (land on the left: counter-clockwise seen from above is clockwise in x east, z south)
    const isl = new Int8Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (Math.abs(x0 + i * cell) <= 100 && Math.abs(z0 + j * cell) <= 100) isl[j * n + i] = 1;
    const ring = [{ closed: true, ids: ["way/9"], points: [[-110, -110], [-110, 110], [110, 110], [110, -110]] }];
    const ps = coastPieces(ring, grid, isl, 270, { reach: 200 });
    // 4 sides of 220 m in 11 pieces each, the closing side among them
    expect(ps.length).toBe(44);
    const first = ps[0], last = ps.at(-1);
    expect(last.next).toEqual({ exposure: first.exposure, sea: first.sea });
    expect(first.prev).toEqual({ exposure: last.exposure, sea: last.sea });
  });
});

describe("white water over the shallows, and boulders", () => {
  // the fixture's sea, shoaling toward the shore: 1 m deep within 60 m of it, 10 m beyond
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = x0 + i * cell;
    heights[k] = label[k] > 0 ? 5 : x > -60 ? -1 : -10;
  }
  const o = { reach: 300, chance: 1 };
  const all = reefPatches(grid, heights, label, 270, o);
  it("lies on every shallow water node exposed enough and nowhere else (every node), seven up-facing triangles each, white fading to the sea", async () => {
    let want = 0;
    for (let k = 0; k < n * n; k++) {
      const i = k % n, j = (k - i) / n;
      if (label[k] < 0 && heights[k] < -0.2 && heights[k] >= -2.5 && exposure(grid, label, x0 + i * cell, z0 + j * cell, 270, { reach: 300 }) >= 0.55) want++;
    }
    expect(want).toBeGreaterThan(0);
    expect(all.patches).toBe(want);
    expect(all.positions.length / 9).toBe(7 * want);
    const P = all.positions;
    for (let t = 0; t < P.length; t += 9) {
      const ux = P[t + 3] - P[t], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vz = P[t + 8] - P[t + 2];
      expect(uz * vx - ux * vz).toBeGreaterThanOrEqual(0);
      // within 0.3 of a cell and 8 m of its node: only over the shallows (x from −60 m, less the jitter and rim)
      expect(P[t]).toBeGreaterThan(-60 - 6 - 8 - 1e-6);
    }
    const { hexToLinear } = await import("./glb.js");
    const white = hexToLinear(SURF.colour), sea = hexToLinear(SURF.fade);
    for (let v = 0; v < all.colors.length; v += 3) {
      const w = (all.colors[v] - sea[0]) / (white[0] - sea[0]);
      expect(w).toBeGreaterThanOrEqual(-1e-6);
      // never more than 0.7 of the way to white
      expect(w).toBeLessThanOrEqual(0.7 + 1e-6);
    }
  });
  it("is local: tile by tile is the whole", () => {
    for (const rows of [1, 9, 41]) {
      const P = [];
      for (let j0 = 0; j0 < n; j0 += rows) P.push(...reefPatches(grid, heights, label, 270, o, j0 * n, Math.min(n, j0 + rows) * n).positions);
      expect(P).toEqual(Array.from(all.positions));
    }
  });
  it("puts a boulder on each piece exposed enough whose hash passes, near its middle, on the sea side, the same every time", () => {
    const pieces = coastPieces(chains, grid, label, 270, { reach: 300 });
    const b = boulders(pieces, { chance: 1 });
    expect(b.boulders).toBe(pieces.filter((p) => p.exposure >= BOULDER.exposure).length);
    expect(b.positions.length / 9).toBe(18 * b.boulders);
    for (let v = 0; v < b.positions.length; v += 3) {
      // off the straight shore at x = 0, 1 to 4 m out, at most 1.6 m in radius
      expect(b.positions[v]).toBeLessThanOrEqual(-1 + 1.6 + 1e-6);
      expect(b.positions[v]).toBeGreaterThanOrEqual(-4 - 1.6 - 1e-6);
      expect(b.positions[v + 1]).toBeGreaterThanOrEqual(-1.2 - 1e-6);
      expect(b.positions[v + 1]).toBeLessThanOrEqual(2 + 1e-6);
    }
    expect(Array.from(boulders(pieces, { chance: 1 }).positions)).toEqual(Array.from(b.positions));
    expect(boulders(pieces, { chance: 0 }).boulders).toBe(0);
  });
});
