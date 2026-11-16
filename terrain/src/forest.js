// Trees, from the canopy and OpenStreetMap (README, "The look"): the forest
// roof, and instanced trees in front of it.
//
// - The canopy at a node is the lidar's (layers.js: surface less terrain)
//   where the place has lidar there, else an assumed height where OSM says
//   wood or scrub (look.trees.assumed), else none. A node is forest where
//   its canopy is over 5 m and nothing OSM maps there forbids trees (yards,
//   beaches, bare rock, lakes).
// - The roof: the ground plus the canopy (smoothed over 3 × 3), over every
//   forest node at least `roofSetback` from the water whose eight
//   neighbours are forest too (so a copse of a node or two is trees, not a
//   green box), through the same RTIN as the ground (tolerance 4 m), dark
//   and a little varied; at its edge it slopes down to just under the
//   ground over one cell. From the water at any distance, this is the
//   forest, for triangles, not instances.
// - Trees: on forest nodes within `fringeWidth` of the water (the fringe
//   that stands at the top of the rock), on every forest node the roof
//   doesn't cover or that borders a node it doesn't (so its edges are
//   ragged with trees), and sparsely on residential lots; one or two a node, jittered within its
//   cell, each its species by the place's mix, its height the canopy's
//   ±15%, its turn and girth by hash. Everything a tree is comes from its
//   node's index and that node's data: placement is local, so the forest of
//   a grid is the union of the forests of its tiles (tested by
//   enumeration). Over `max`, the ones whose own hash is lowest are kept:
//   still a function of each node alone, given that threshold.
//
// Species shapes and colours are art direction (README); the mixes are the
// place's (assumptions). Pure.

import { soup, cylinder } from "./shapes.js";
import { COVER } from "./cover.js";
import { hash01 } from "./palette.js";
import { rtinErrors, rtinMesh } from "./rtin.js";
import { hexToLinear } from "./glb.js";
import { dsin, dcos } from "./detmath.js";

/** Species: a crown (cones, or a round crown), its width over its height, its colours. Unit height. */
export const SPECIES = Object.freeze({
  hemlock: { crown: "cones", width: 0.28, tiers: 4, base: 0.22, foliage: "#22331f", trunk: "#4a4038" },
  cedar: { crown: "cones", width: 0.4, tiers: 3, base: 0.12, flare: 1.25, foliage: "#3a4a2c", trunk: "#6a432c" },
  spruce: { crown: "cones", width: 0.35, tiers: 4, base: 0.15, foliage: "#2a3a33", trunk: "#5a5048" },
  fir: { crown: "cones", width: 0.32, tiers: 4, base: 0.3, foliage: "#2b3a26", trunk: "#5d4a3a" },
  pine: { crown: "round", width: 0.55, base: 0.45, foliage: "#3b4a2e", trunk: "#5a4a3c" },
  alder: { crown: "round", width: 0.5, base: 0.4, foliage: "#4f6a3a", trunk: "#b8b6ae" },
  oak: { crown: "round", width: 0.8, base: 0.35, foliage: "#4a5a32", trunk: "#4d4339" },
  arbutus: { crown: "round", width: 0.6, base: 0.35, foliage: "#4d6236", trunk: "#9a4f2e" },
});
export const SPECIES_NAMES = Object.freeze(Object.keys(SPECIES));

/** One tree of a species, 1 m tall, its foot at the origin, as a triangle soup (positions, colours, linear RGB). */
export function treeMesh(name) {
  const sp = SPECIES[name];
  const s = soup();
  const r = sp.width / 2;
  cylinder(s, 0, 0, -0.05, sp.base + 0.08, 0.022, 0.018, sp.trunk, 6);
  if (sp.crown === "cones") {
    const tiers = sp.tiers;
    const span = 1 - sp.base;
    for (let t = 0; t < tiers; t++) {
      const y0 = sp.base + (span * t) / (tiers + 0.6);
      const y1 = t === tiers - 1 ? 1 : y0 + (span * 1.9) / (tiers + 0.6);
      const rr = r * (1 - t / (tiers + 0.4)) * (t === 0 && sp.flare ? sp.flare : 1);
      cylinder(s, 0, 0, y0, y1, rr, 0, sp.foliage, 7);
    }
  } else {
    // a round crown: a squat bicone, then a cap
    const y0 = sp.base, ym = sp.base + (1 - sp.base) * 0.45;
    cylinder(s, 0, 0, y0, ym, r * 0.55, r, sp.foliage, 7);
    cylinder(s, 0, 0, ym, 0.88, r, r * 0.55, sp.foliage, 7);
    cylinder(s, 0, 0, 0.88, 1, r * 0.55, 0, sp.foliage, 7);
  }
  return s.done();
}

/** Pick from a mix ({ species: weight }) by u in [0, 1): the species names in SPECIES order. */
export function pick(mix, u) {
  const entries = SPECIES_NAMES.filter((s) => mix?.[s] > 0).map((s) => [s, mix[s]]);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let x = u * total;
  for (const [s, w] of entries) {
    if (x < w) return s;
    x -= w;
  }
  return entries.at(-1)[0];
}

const NO_TREES = new Set([COVER.yard, COVER.lake, COVER.beach, COVER.rock]);

/**
 * The canopy each node stands for (metres): the lidar's where `measured`,
 * else the assumed height where OSM says wood (or scrub), else 0. The
 * assumed height varies ±20% by node.
 */
export function effectiveCanopy({ n, label, cover, canopy = null, measured = null, assumed = { wood: 18, scrub: 3 } }) {
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (label[k] <= 0) continue;
    if (canopy && measured?.[k]) out[k] = canopy[k];
    else if (cover[k] === COVER.wood) out[k] = (assumed.wood ?? 18) * (0.8 + 0.4 * hash01(k, 3));
    else if (cover[k] === COVER.scrub) out[k] = (assumed.scrub ?? 3) * (0.8 + 0.4 * hash01(k, 3));
  }
  return out;
}

/** Whether node k is forest: land, its canopy over 5 m, nothing there that forbids trees. */
export const isForest = (k, label, cover, canopy) => label[k] > 0 && canopy[k] > 5 && !NO_TREES.has(cover[k]);

/** The 8 neighbours of node k that are in the grid. */
function around(n, k) {
  const i = k % n, j = (k - i) / n;
  const out = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < n && jj < n) out.push(jj * n + ii);
  }
  return out;
}

/** Whether node k is under the forest roof: forest, `setback` from the water, its eight neighbours forest (a node on the grid's edge isn't). */
export function isRoof(k, { n, label, cover, canopy, dist, setback }) {
  if (!isForest(k, label, cover, canopy) || dist[k] <= setback) return false;
  const nb = around(n, k);
  return nb.length === 8 && nb.every((m) => isForest(m, label, cover, canopy));
}

/**
 * The trees standing on nodes [k0, k1) (all of them by default): each
 * { k, t, species, x, z, height, yaw, girth, key } before any thinning.
 * @param {object} o  { grid, label, cover, canopy (effective), dist (to water), trees (the place's look.trees) }
 */
export function treesAt({ grid, label, cover, canopy, dist, trees }, k0 = 0, k1 = grid.n * grid.n) {
  const { n, cell, x0, z0 } = grid;
  const fringe = trees.fringeWidth ?? 40;
  const setback = trees.roofSetback ?? 20;
  const roof = (k) => isRoof(k, { n, label, cover, canopy, dist, setback });
  const town = (trees.townPerHectare ?? 25) * (cell * cell) / 1e4;
  const out = [];
  for (let k = k0; k < k1; k++) {
    if (label[k] <= 0 || NO_TREES.has(cover[k])) continue;
    const i = k % n, j = (k - i) / n;
    const forest = isForest(k, label, cover, canopy);
    let mix = null, count = 0, h = 0;
    if (forest) {
      // at the roof's edge: not under it, or next to a node that isn't
      const edge = !roof(k) || around(n, k).some((m) => !roof(m));
      if (dist[k] > fringe && !edge) continue;
      mix = cover[k] === COVER.wetland ? trees.wetland : dist[k] <= fringe ? trees.fringe : trees.inland;
      count = 1 + (hash01(k, 1) < (trees.second ?? 0.5) ? 1 : 0);
      h = canopy[k];
    } else if (cover[k] === COVER.residential && hash01(k, 2) < town) {
      mix = trees.town;
      count = 1;
      h = trees.townHeight ?? 12;
    } else continue;
    for (let t = 0; t < count; t++) {
      const species = pick(mix ?? trees.inland, hash01(k, 10 + t));
      if (!species) continue;
      const height = Math.min(55, Math.max(3, h * (0.85 + 0.3 * hash01(k, 20 + t))));
      out.push({
        k,
        t,
        species,
        x: x0 + (i + (hash01(k, 30 + t) - 0.5) * 0.9) * cell,
        z: z0 + (j + (hash01(k, 40 + t) - 0.5) * 0.9) * cell,
        height,
        yaw: hash01(k, 50 + t) * Math.PI * 2,
        girth: 0.9 + 0.2 * hash01(k, 60 + t),
        key: hash01(k * 4 + t, 99),
      });
    }
  }
  return out;
}

/** Every tree in the grid, thinned to `max` by each tree's own key (the lowest kept). */
export function placeTrees(o) {
  const all = treesAt(o);
  const max = o.trees.max ?? Infinity;
  if (all.length <= max) return { trees: all, threshold: 1, before: all.length };
  const keys = all.map((t) => t.key).sort((a, b) => a - b);
  const threshold = keys[max - 1];
  return { trees: all.filter((t) => t.key <= threshold), threshold, before: all.length };
}

/**
 * The forest roof: an RTIN over the ground plus the smoothed canopy at
 * roof nodes (forest, at least `setback` from the water); every other node
 * sunk to `floor`, and triangles with no roof node dropped, so the roof's
 * edge dives into the ground. → { positions, normals?, colors, indices, roofNodes } (no normals: computed by the caller).
 */
export function forestRoof({ grid, heights, label, cover, canopy, dist, setback = 20, tolerance = 4, floor = -80, colours = ["#16231a", "#1d2c1b", "#263524", "#34432a", "#2c3b33"] }) {
  const { n, cell, x0, z0 } = grid;
  const N = n * n;
  const roof = new Uint8Array(N);
  let count = 0;
  for (let k = 0; k < N; k++) if (isRoof(k, { n, label, cover, canopy, dist, setback })) (roof[k] = 1), count++;
  if (!count) return null;
  const top = new Float32Array(N), tol = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    tol[k] = tolerance;
    if (!roof[k]) {
      // the ring round the roof just under the ground (so its edge slopes down over a cell); everything else far down, flat
      top[k] = around(n, k).some((m) => roof[m]) ? heights[k] - 1 : floor;
      if (top[k] !== floor) tol[k] = 0.5;
      continue;
    }
    const i = k % n, j = (k - i) / n;
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const m = jj * n + ii;
      if (roof[m]) (s += canopy[m]), c++;
    }
    top[k] = heights[k] + s / c;
  }
  const mesh = rtinMesh(n, rtinErrors(n, top, tol));
  const tris = [];
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const a = mesh.triangles[t], b = mesh.triangles[t + 1], c = mesh.triangles[t + 2];
    if (roof[mesh.nodes[a]] || roof[mesh.nodes[b]] || roof[mesh.nodes[c]]) tris.push(a, b, c);
  }
  // only the vertices the kept triangles use
  const used = new Int32Array(mesh.nodes.length).fill(-1);
  const order = [];
  for (const v of tris) if (used[v] < 0) (used[v] = order.length), order.push(v);
  const V = order.length;
  const positions = new Float32Array(V * 3), colors = new Float32Array(V * 3);
  const lin = colours.map((c) => hexToLinear(c).slice(0, 3));
  order.forEach((v, q) => {
    const k = mesh.nodes[v];
    const i = k % n, j = (k - i) / n;
    positions[q * 3] = x0 + i * cell;
    positions[q * 3 + 1] = top[k];
    positions[q * 3 + 2] = z0 + j * cell;
    const u = hash01(k, 77);
    const c = lin[u < 0.25 ? 0 : u < 0.55 ? 1 : u < 0.8 ? 2 : u < 0.9 ? 3 : 4];
    colors.set(c, q * 3);
  });
  const indices = Uint32Array.from(tris, (v) => used[v]);
  return { positions, colors, indices, roofNodes: count };
}

/** The GLB meshes for the trees' species, and a node per tree (instanced by the scene: one draw a species). */
export function treeInstances(trees, groundAt, sinkAt, { meshBase, layer = "forest" } = {}) {
  const species = SPECIES_NAMES.filter((s) => trees.some((t) => t.species === s));
  const meshes = species.map((s) => {
    const m = treeMesh(s);
    return { name: `Tree (${s})`, positions: m.positions, colors: m.colors, roughness: 0.95 };
  });
  const index = Object.fromEntries(species.map((s, q) => [s, meshBase + q]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const nodes = trees.map((t) => {
    const g = groundAt(t.x, t.z);
    const sink = sinkAt(g);
    const h = t.height + sink;
    const yaw = t.yaw;
    return { mesh: index[t.species], translation: [r2(t.x), r2(g - sink), r2(t.z)], rotation: [0, r4(dsin(yaw / 2)), 0, r4(dcos(yaw / 2))], scale: [r2(h * t.girth), r2(h), r2(h * t.girth)] };
  });
  return { meshes, nodes, species, layer };
}
