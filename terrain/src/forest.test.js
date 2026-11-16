import { describe, it, expect } from "vitest";
import { treesAt, placeTrees, pick, forestRoof, treeMesh, standMesh, treeInstances, effectiveCanopy, isForest, isRoof, builtMask, TREE_REACH, SPECIES, SPECIES_NAMES, STAND_HEIGHTS, skinZone, skinAt, placeSkin, skinMesh, skinInstances, SKIN_LAYOUTS, SKIN_CROWN, SPRUCE, SNAG, crownsOf, scrubCover, isScrub, crownShape, crownTriangles } from "./forest.js";
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

describe("stands at the water, and a denser town", () => {
  // the town's lots without a canopy (a lot under trees is forest, and gets the forest's)
  const canopyT = Float32Array.from(canopy, (c, k) => (cover[k] === COVER.residential ? 1 : c));
  const oT = { ...o, canopy: canopyT };
  const dense = { ...oT, trees: { ...trees, stands: [4, 6], townPerHectare: 50 } };
  const all = treesAt(dense);
  const plain = treesAt(oT);
  it("gives every fringe forest node (not a bog's) one stand of 4 to 6 crowns, by its hash, and everything else what it had", () => {
    const per = new Map();
    for (const t of all) per.set(t.k, [...(per.get(t.k) ?? []), t]);
    const sizes = new Set();
    for (let k = 0; k < N; k++) {
      const here = per.get(k) ?? [];
      const was = plain.filter((t) => t.k === k);
      const fringe = isForest(k, label, cover, canopyT) && dist[k] <= 40 && cover[k] !== COVER.wetland;
      if (fringe) {
        expect(here).toHaveLength(1);
        expect(here[0].crowns).toBeGreaterThanOrEqual(4);
        expect(here[0].crowns).toBeLessThanOrEqual(6);
        sizes.add(here[0].crowns);
        // the same tree as the first it had, but for its crowns
        const { crowns, ...rest } = here[0];
        expect(rest).toEqual(was[0]);
      } else if (cover[k] === COVER.residential && label[k] > 0) {
        // 50 a hectare is two a 20 m node
        expect(here).toHaveLength(2);
        expect(here.every((t) => !t.crowns)).toBe(true);
      } else expect(here).toEqual(was);
    }
    expect([...sizes].sort()).toEqual([4, 5, 6]);
  });
  it("is local all the same: tile by tile is the whole", () => {
    for (const rows of [1, 5, 33]) {
      const tiles = [];
      for (let j0 = 0; j0 < n; j0 += rows) tiles.push(...treesAt(dense, j0 * n, Math.min(n, j0 + rows) * n));
      expect(tiles).toEqual(all);
    }
  });
  it("draws a stand as its crowns: the tallest a metre in the middle, the rest round it shorter, trunks to 0.2 below the foot", () => {
    for (const s of SPECIES_NAMES) for (const c of [4, 5, 6]) {
      const one = treeMesh(s, -0.2), st = standMesh(s, c);
      expect(st.positions.length).toBe(one.positions.length * c);
      let ymin = Infinity, ymax = -Infinity, r = 0;
      for (let v = 0; v < st.positions.length; v += 3) {
        ymin = Math.min(ymin, st.positions[v + 1]);
        ymax = Math.max(ymax, st.positions[v + 1]);
        r = Math.max(r, Math.hypot(st.positions[v], st.positions[v + 2]));
      }
      expect(ymin).toBeCloseTo(-0.2, 6);
      expect(ymax).toBeCloseTo(1, 6);
      expect(r).toBeLessThanOrEqual(0.16 + (SPECIES[s].width / 2) * (SPECIES[s].flare ?? 1) * Math.max(...STAND_HEIGHTS) + 1e-6);
    }
  });
  it("instances each species and stand size from its own mesh", () => {
    const inst = treeInstances(all, () => 0, () => 0.5, { meshBase: 7 });
    const kinds = new Set(all.map((t) => (t.crowns ? `${t.species}×${t.crowns}` : t.species)));
    expect(new Set(inst.species)).toEqual(kinds);
    expect(inst.meshes.map((m) => m.name).filter((x) => x.startsWith("Stand of")).length).toBe([...kinds].filter((x) => x.includes("×")).length);
    all.forEach((t, q) => expect(inst.species[inst.nodes[q].mesh - 7]).toBe(t.crowns ? `${t.species}×${t.crowns}` : t.species));
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

describe("the roof's raggedness", () => {
  it("moves each roof node by its own hash, at most `jitter` either way, and nothing else", () => {
    const heights = Float32Array.from({ length: N }, (_, k) => (label[k] > 0 ? 10 + (k % n) : -5));
    const flat = forestRoof({ grid, heights, label, cover, canopy, dist, setback: 20 });
    const rough = forestRoof({ grid, heights, label, cover, canopy, dist, setback: 20, jitter: 3 });
    expect(Array.from(rough.indices)).toEqual(Array.from(flat.indices));
    let moved = 0;
    for (let v = 0; v < flat.positions.length / 3; v++) {
      const i = Math.round((flat.positions[v * 3] - x0) / cell), j = Math.round((flat.positions[v * 3 + 2] - z0) / cell);
      const d = rough.positions[v * 3 + 1] - flat.positions[v * 3 + 1];
      expect(Math.abs(d)).toBeLessThanOrEqual(3 + 1e-4);
      if (!isRoof(j * n + i, { n, label, cover, canopy, dist, setback: 20 })) expect(d).toBe(0);
      else if (d !== 0) moved++;
    }
    expect(moved).toBeGreaterThan(0);
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

describe("the forest's skin", () => {
  // two circles: one round the middle of the forest, one off the grid's south-east corner reaching into it
  const circles = [{ x: 0, z: 0, radius: 130 }, { x: 330, z: 330, radius: 90 }];
  const zone = skinZone(grid, circles);
  const so = { grid, label, cover, canopy, dist, zone, skin: { crowns: [3, 4] }, setback: 20 };
  const all = skinAt(so);
  it("zones exactly the nodes within a circle (every node)", () => {
    for (let k = 0; k < N; k++) {
      const i = k % n, j = (k - i) / n, x = x0 + i * cell, z = z0 + j * cell;
      expect(zone[k]).toBe(circles.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.radius ** 2) ? 1 : 0);
    }
  });
  it("puts one clump on every roof node in the zone and nowhere else (every node), of 4 crowns (a roof's), its canopy's height ±8%, a quarter turn, never shrunk", () => {
    const by = new Map(all.map((c) => [c.k, c]));
    expect(by.size).toBe(all.length);
    let some = 0;
    for (let k = 0; k < N; k++) {
      const roof = isRoof(k, { n, label, cover, canopy, dist, setback: 20 });
      expect(by.has(k)).toBe(!!(zone[k] && roof));
      if (!by.has(k)) continue;
      some++;
      const c = by.get(k);
      const i = k % n, j = (k - i) / n;
      expect([c.x, c.z]).toEqual([x0 + i * cell, z0 + j * cell]);
      expect(c.crowns).toBe(4);
      expect(((c.yaw / (Math.PI / 2)) % 1 + 1) % 1).toBeCloseTo(0, 9);
      expect(c.variant).toBeGreaterThanOrEqual(0);
      expect(c.variant).toBeLessThan(SKIN_LAYOUTS[c.crowns].length);
      expect(c.height).toBeGreaterThanOrEqual(canopy[k] * 0.92 - 1e-9);
      expect(c.height).toBeLessThanOrEqual(canopy[k] * 1.08 + 1e-9);
      expect(c.width).toBeGreaterThanOrEqual(1);
      expect(c.width).toBeLessThanOrEqual(1.15);
      expect(c.depth).toBeGreaterThanOrEqual(1);
      expect(c.depth).toBeLessThanOrEqual(1.15);
    }
    expect(some).toBeGreaterThan(20);
    // more than one layout occurs
    expect(new Set(all.map((c) => `${c.crowns}/${c.variant}`)).size).toBeGreaterThan(2);
  });
  it("is local: tile by tile is the whole (every split into rows of tiles)", () => {
    for (const rows of [1, 4, 11, 33]) {
      const tiles = [];
      for (let j0 = 0; j0 < n; j0 += rows) tiles.push(...skinAt(so, j0 * n, Math.min(n, j0 + rows) * n));
      expect(tiles).toEqual(all);
    }
  });
  it("puts none where built, and none outside every circle", () => {
    const built = new Uint8Array(N).fill(1);
    expect(skinAt({ ...so, built })).toEqual([]);
    expect(skinAt({ ...so, zone: skinZone(grid, []) })).toEqual([]);
  });
  it("thins to exactly `max` by each clump's own key, keeping the lowest", () => {
    const max = Math.floor(all.length / 3);
    const { clumps, before } = placeSkin({ ...so, skin: { ...so.skin, max } });
    expect(before).toBe(all.length);
    expect(clumps.length).toBe(max);
    const kept = new Set(clumps.map((c) => c.k));
    const cut = Math.max(...clumps.map((c) => c.key));
    for (const c of all) expect(kept.has(c.k)).toBe(c.key <= cut);
  });
  it("draws a clump as its crowns, each its shape's triangles, inside its cell's reach, from its foot to its top (every layout)", () => {
    for (const crowns of [3, 4]) for (let v = 0; v < SKIN_LAYOUTS[crowns].length; v++) {
      const m = skinMesh(crowns, v, cell);
      const layout = SKIN_LAYOUTS[crowns][v];
      const snags = layout.filter((c) => c[3] === "snag").length;
      const tris = crownsOf(layout).reduce((a, x, q) => a + crownTriangles(crownShape(false, x[3], crowns, v, q)), 0);
      expect(m.positions.length / 9).toBe(tris + 8 * snags);
      const lowest = Math.min(...crownsOf(layout).map((c) => c[2]), snags ? SNAG.from / SKIN_CROWN.foot : Infinity);
      const top = Math.max(...crownsOf(layout).map((c) => c[2] * (c[3] === "spruce" ? SPRUCE.taller : 1)), snags ? SNAG.top : 0);
      for (let q = 0; q < m.positions.length; q += 3) {
        expect(Math.abs(m.positions[q])).toBeLessThanOrEqual(cell * 0.3 + SKIN_CROWN.radius * 1.08 + 1e-6);
        expect(Math.abs(m.positions[q + 2])).toBeLessThanOrEqual(cell * 0.3 + SKIN_CROWN.radius * 1.08 + 1e-6);
        expect(m.positions[q + 1]).toBeGreaterThanOrEqual(SKIN_CROWN.foot * lowest - 1e-6);
        expect(m.positions[q + 1]).toBeLessThanOrEqual(top + 1e-6);
      }
    }
  });
  it("instances each clump from its size and layout's mesh, its foot on the ground, its height its scale", () => {
    const inst = skinInstances(all, (x, z) => 0.01 * x + 2, { meshBase: 10, cell });
    expect(inst.nodes.length).toBe(all.length);
    expect(inst.meshes.length).toBe(inst.kinds.length);
    all.forEach((c, q) => {
      const nd = inst.nodes[q];
      expect(nd.mesh).toBe(10 + inst.kinds.indexOf(`${c.crowns}/${c.variant}`));
      expect(nd.translation[1]).toBeCloseTo(0.01 * c.x + 2, 2);
      expect(nd.scale[1]).toBeCloseTo(c.height, 2);
    });
  });
});

describe("the low scrub", () => {
  const heights = new Float32Array(N);
  for (let k = 0; k < N; k++) heights[k] = label[k] > 0 ? 10 + (k % 7) : -5;
  const sc = scrubCover({ grid, heights, label, cover, canopy, dist, jitter: 1.5 });
  it("lies only where the canopy is from 0.8 to 5 m on wild land (here, the clearing), every kept triangle touching such a node", () => {
    const want = [];
    for (let k = 0; k < N; k++) if (isScrub(k, { label, cover, canopy, dist })) want.push(k);
    // the clearing's 9 nodes, canopy 1 m, in the wood
    expect(want.length).toBe(9);
    expect(sc.roofNodes).toBe(9);
    for (let t = 0; t < sc.indices.length; t += 3) {
      const ks = [0, 1, 2].map((e) => {
        const v = sc.indices[t + e];
        return Math.round((sc.positions[v * 3 + 2] - z0) / cell) * n + Math.round((sc.positions[v * 3] - x0) / cell);
      });
      expect(ks.some((k) => want.includes(k))).toBe(true);
    }
  });
  it("stands at the canopy's height over the ground (at least a metre), ±1.5 m by hash, and its ring just under the ground", () => {
    for (let v = 0; v < sc.positions.length / 3; v++) {
      const i = Math.round((sc.positions[v * 3] - x0) / cell), j = Math.round((sc.positions[v * 3 + 2] - z0) / cell), k = j * n + i;
      const y = sc.positions[v * 3 + 1];
      if (isScrub(k, { label, cover, canopy, dist })) {
        expect(Math.abs(y - (heights[k] + Math.max(1, canopy[k])))).toBeLessThanOrEqual(1.5 + 1e-5);
      } else expect(y).toBeCloseTo(heights[k] - 1, 5);
    }
  });
  it("grows on no lot, lawn or yard: none on the town's lots though their canopy were scrub's", () => {
    const low = Float32Array.from(canopy, (c, k) => (cover[k] === COVER.residential ? 2 : c));
    for (let k = 0; k < N; k++) if (cover[k] === COVER.residential) expect(isScrub(k, { label, cover, canopy: low, dist })).toBe(false);
  });
});
