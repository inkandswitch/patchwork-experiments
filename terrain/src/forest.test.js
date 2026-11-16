import { describe, it, expect } from "vitest";
import { treesAt, placeTrees, pick, forestRoof, treeMesh, effectiveCanopy, isForest, isRoof, builtMask, TREE_REACH, SPECIES, SPECIES_NAMES } from "./forest.js";
import { insideRing } from "./terrain-sample.js";
import { COVER } from "./cover.js";

// a made-up 33 × 33 place: water down the west, a forest east of it with a clearing, a yard, a town lot, a bog
const n = 33, cell = 20, x0 = -320, z0 = -320, N = n * n;
const grid = { n, cell, x0, z0 };
const label = new Int8Array(N), cover = new Uint8Array(N), canopy = new Float32Array(N), dist = new Float32Array(N);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const k = j * n + i;
  label[k] = i < 6 ? -1 : 1;
  dist[k] = i < 6 ? 0 : (i - 5) * cell;
  if (label[k] < 0) continue;
  cover[k] = j > 26 ? COVER.residential : i > 28 && j < 5 ? COVER.yard : j < 4 && i < 12 ? COVER.wetland : COVER.wood;
  canopy[k] = i >= 15 && i <= 17 && j >= 10 && j <= 12 ? 1 : 8 + ((i * 7 + j * 3) % 20);
}
const trees = { fringe: { spruce: 45, hemlock: 25, cedar: 20, pine: 10 }, inland: { hemlock: 50, cedar: 35, spruce: 10, alder: 5 }, town: { alder: 100 }, wetland: { pine: 100 }, fringeWidth: 40, roofSetback: 20, townPerHectare: 25 };
const o = { grid, label, cover, canopy, dist, trees };

describe("pick", () => {
  it("picks species in proportion to their weights, exactly, over evenly spaced draws", () => {
    const counts = {};
    for (let q = 0; q < 100; q++) {
      const s = pick(trees.fringe, (q + 0.5) / 100);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    expect(counts).toEqual({ spruce: 45, hemlock: 25, cedar: 20, pine: 10 });
    expect(pick({}, 0.5)).toBe(null);
  });
});

describe("treesAt", () => {
  const all = treesAt(o);
  it("is local: the trees of the grid are the trees of its tiles, tile by tile (every split into rows of tiles)", () => {
    for (const rows of [1, 2, 5, 11, 33]) {
      const tiles = [];
      for (let j0 = 0; j0 < n; j0 += rows) tiles.push(...treesAt(o, j0 * n, Math.min(n, j0 + rows) * n));
      expect(tiles).toEqual(all);
    }
  });
  it("stands each tree on a node that may have one, inside its cell, one or two a forest node, of that node's mix, its canopy's height ±15%", () => {
    const per = new Map();
    for (const t of all) {
      const k = t.k, i = k % n, j = (k - i) / n;
      per.set(k, (per.get(k) ?? 0) + 1);
      expect(label[k]).toBe(1);
      expect(cover[k] === COVER.yard).toBe(false);
      expect(Math.abs(t.x - (x0 + i * cell))).toBeLessThanOrEqual(0.45 * cell);
      expect(Math.abs(t.z - (z0 + j * cell))).toBeLessThanOrEqual(0.45 * cell);
      if (isForest(k, label, cover, canopy)) {
        const mix = cover[k] === COVER.wetland ? trees.wetland : dist[k] <= 40 ? trees.fringe : trees.inland;
        expect(mix[t.species]).toBeGreaterThan(0);
        expect(t.height).toBeGreaterThanOrEqual(Math.max(3, canopy[k] * 0.85) - 1e-9);
        expect(t.height).toBeLessThanOrEqual(canopy[k] * 1.15 + 1e-9);
      } else {
        expect(cover[k]).toBe(COVER.residential);
        expect(t.species).toBe("alder");
      }
    }
    for (const c of per.values()) expect(c === 1 || c === 2).toBe(true);
  });
  it("puts trees on every forest node of the fringe and the roof's edges, and none under the roof's middle", () => {
    const has = new Set(all.map((t) => t.k));
    const setback = 20;
    for (let k = 0; k < N; k++) {
      if (!isForest(k, label, cover, canopy)) continue;
      const i = k % n, j = (k - i) / n;
      const nb = [];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && i + di >= 0 && j + dj >= 0 && i + di < n && j + dj < n) nb.push((j + dj) * n + i + di);
      const edge = !isRoof(k, { n, label, cover, canopy, dist, setback }) || nb.some((m) => !isRoof(m, { n, label, cover, canopy, dist, setback }));
      expect(has.has(k)).toBe(dist[k] <= 40 || edge);
    }
  });
});

describe("placeTrees", () => {
  it("thins to exactly `max` by each tree's own key, keeping the lowest", () => {
    const all = treesAt(o);
    const max = Math.floor(all.length / 3);
    const { trees: kept, threshold, before } = placeTrees({ ...o, trees: { ...trees, max } });
    expect(before).toBe(all.length);
    expect(kept).toHaveLength(max);
    expect(kept.every((t) => t.key <= threshold)).toBe(true);
    expect(all.filter((t) => t.key <= threshold)).toEqual(kept);
  });
});

describe("forestRoof", () => {
  it("covers the roof's nodes only (every kept triangle touches one), at the ground plus the smoothed canopy", () => {
    const heights = Float32Array.from({ length: N }, (_, k) => (label[k] > 0 ? 10 + (k % n) : -5));
    const roof = forestRoof({ grid, heights, label, cover, canopy, dist, setback: 20 });
    expect(roof.roofNodes).toBeGreaterThan(0);
    const P = roof.positions;
    const at = (v) => {
      const i = Math.round((P[v * 3] - x0) / cell), j = Math.round((P[v * 3 + 2] - z0) / cell);
      return j * n + i;
    };
    const roofy = (k) => isRoof(k, { n, label, cover, canopy, dist, setback: 20 });
    for (let t = 0; t < roof.indices.length; t += 3) expect([0, 1, 2].some((e) => roofy(at(roof.indices[t + e])))).toBe(true);
    for (let v = 0; v < P.length / 3; v++) {
      const k = at(v);
      if (!roofy(k)) continue;
      const i = k % n, j = (k - i) / n;
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const m = (j + dj) * n + i + di;
        if (roofy(m)) (s += canopy[m]), c++;
      }
      expect(P[v * 3 + 1]).toBeCloseTo(heights[k] + s / c, 4);
    }
  });
});

describe("the trees' meshes", () => {
  it("are each a metre tall with their foot at the origin, no wider than their species' width", () => {
    for (const s of SPECIES_NAMES) {
      const { positions } = treeMesh(s);
      let ymin = Infinity, ymax = -Infinity, r = 0;
      for (let v = 0; v < positions.length; v += 3) {
        ymin = Math.min(ymin, positions[v + 1]);
        ymax = Math.max(ymax, positions[v + 1]);
        r = Math.max(r, Math.hypot(positions[v], positions[v + 2]));
      }
      // (float32)
      expect(ymin).toBeCloseTo(-0.05, 6);
      expect(ymax).toBeCloseTo(1, 6);
      expect(r).toBeLessThanOrEqual((SPECIES[s].width / 2) * (SPECIES[s].flare ?? 1) + 1e-6);
    }
  });
});

describe("effectiveCanopy", () => {
  it("is the lidar's where it was measured, an assumed height in OSM's woods and scrub where not, and nothing elsewhere", () => {
    const lab = Int8Array.from([1, 1, 1, 1, -1]), cov = Uint8Array.from([COVER.wood, COVER.wood, COVER.scrub, COVER.residential, COVER.wood]);
    const e = effectiveCanopy({ n: 2, label: lab, cover: cov, canopy: Float32Array.from([30, 30, 30, 30]), measured: Uint8Array.from([1, 0, 0, 0]), assumed: { wood: 20, scrub: 3 } });
    expect(e[0]).toBe(30);
    expect(e[1]).toBeGreaterThanOrEqual(16);
    expect(e[1]).toBeLessThanOrEqual(24);
    expect(e[2]).toBeGreaterThanOrEqual(2.4);
    expect(e[2]).toBeLessThanOrEqual(3.6);
    expect(e[3]).toBe(0);
  });
});

describe("no forest on what's built (the lidar's canopy is a roof's height there too)", () => {
  // 24 footprints over the wood and the town: 3–30 m, turned 0–345°, some smaller than a cell and between nodes, two straddling the fringe
  const rings = [];
  for (let q = 0; q < 24; q++) {
    const cx = x0 + (7.3 + (q % 6) * 3.7) * cell, cz = z0 + (5.6 + Math.floor(q / 6) * 6.1) * cell;
    const a = (q * 15 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const hu = 1.5 + (q % 7) * 2.1, hv = 1.5 + (q % 5) * 1.6;
    rings.push([[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]));
  }
  const built = builtMask(grid, rings);
  // the distance from a point to a ring (0 inside), by brute force
  const distTo = (pts, x, z) => {
    if (insideRing(pts, x, z)) return 0;
    let d = Infinity;
    for (let e = 0; e < pts.length; e++) {
      const [xa, za] = pts[e], [xb, zb] = pts[(e + 1) % pts.length];
      for (let q = 0; q <= 400; q++) d = Math.min(d, Math.hypot(xa + ((xb - xa) * q) / 400 - x, za + ((zb - za) * q) / 400 - z));
    }
    return d;
  };
  it("marks exactly the nodes on a footprint or within a tree's reach of one (every node)", () => {
    const reach = TREE_REACH * cell;
    for (let k = 0; k < N; k++) {
      const i = k % n, j = (k - i) / n;
      const d = Math.min(...rings.map((r) => distTo(r, x0 + i * cell, z0 + j * cell)));
      // the brute force samples each edge at 400 points: within a hair of the reach either way it can't tell
      if (Math.abs(d - reach) < 0.05) continue;
      expect([k, built[k]]).toEqual([k, d < reach ? 1 : 0]);
    }
    expect(built.reduce((a, b) => a + b, 0)).toBeGreaterThan(24);
  });
  it("puts no tree on a footprint and no roof within two nodes of one, though the wood's canopy is over every node (every tree, every node)", () => {
    const canopyB = effectiveCanopy({ n, label, cover, canopy, measured: Uint8Array.from(canopy, () => 1), built });
    const ob = { ...o, canopy: canopyB, built };
    const all = treesAt(ob);
    expect(all.length).toBeGreaterThan(100);
    for (const t of all) {
      expect(built[t.k]).toBe(0);
      for (const r of rings) expect([t.k, t.t, insideRing(r, t.x, t.z)]).toEqual([t.k, t.t, false]);
    }
    let roofs = 0;
    for (let k = 0; k < N; k++) {
      if (!isRoof(k, { n, label, cover, canopy: canopyB, dist, setback: 20 })) continue;
      roofs++;
      const i = k % n, j = (k - i) / n;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const m = (j + dj) * n + i + di;
        expect([k, m, built[m]]).toEqual([k, m, 0]);
      }
    }
    expect(roofs).toBeGreaterThan(0);
    // and the grid's trees are still its tiles' trees
    const tiles = [];
    for (let j0 = 0; j0 < n; j0 += 5) tiles.push(...treesAt(ob, j0 * n, Math.min(n, j0 + 5) * n));
    expect(tiles).toEqual(all);
  });
  it("leaves the canopy nothing where built, and is the lidar's elsewhere", () => {
    const e = effectiveCanopy({ n, label, cover, canopy, measured: Uint8Array.from(canopy, () => 1), built });
    for (let k = 0; k < N; k++) expect(e[k]).toBe(label[k] > 0 && !built[k] ? canopy[k] : 0);
  });
});
