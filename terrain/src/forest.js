// Trees, from the canopy and OpenStreetMap (README, "The look"): the forest
// roof, and instanced trees in front of it.
//
// - The canopy at a node is the lidar's (layers.js: surface less terrain)
//   where the place has lidar there, else an assumed height where OSM says
//   wood or scrub (look.trees.assumed), else none; and none at a node built
//   on (builtMask: on or near a building's footprint, or a site's own lot),
//   since the lidar's surface less its terrain is a roof's height there as
//   much as a tree's. A node is forest where its canopy is over 5 m and
//   nothing OSM maps there forbids trees (yards, beaches, bare rock, lakes).
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
//   enumeration). Over `max`, the ones whose own key is lowest are kept
//   (the fringe's first, then the rest, each by hash): still a function of
//   each node alone, given that threshold.
//
// Species shapes and colours are art direction (README); the mixes are the
// place's (assumptions). Pure.

import { soup, cylinder } from "./shapes.js";
import { COVER } from "./cover.js";
import { hash01 } from "./palette.js";
import { rtinErrors, rtinMesh } from "./rtin.js";
import { hexToLinear } from "./glb.js";
import { dsin, dcos, len } from "./detmath.js";
import { insideRing } from "./terrain-sample.js";

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
export function treeMesh(name, foot = -0.05, lowest = 1) {
  const sp = { ...SPECIES[name], base: Math.min(SPECIES[name].base, lowest) };
  const s = soup();
  const r = sp.width / 2;
  cylinder(s, 0, 0, foot, sp.base + 0.08, 0.022, 0.018, sp.trunk, 6);
  const trunk = s.count;
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
  // the foliage shaded from CROWN_SHADE[0] at the crown's foot to CROWN_SHADE[1] at its top: the inside of a crown, and the gaps between, read as shadow
  const out = s.done();
  for (let v = trunk; v < out.positions.length / 3; v++) {
    const f = CROWN_SHADE[0] + (CROWN_SHADE[1] - CROWN_SHADE[0]) * Math.max(0, Math.min(1, (out.positions[v * 3 + 1] - sp.base) / (1 - sp.base)));
    for (let c = 0; c < 3; c++) out.colors[v * 3 + c] *= f;
  }
  return out;
}

/**
 * A stand: `crowns` trees of a species close together, the tallest 1 m in
 * the middle and the rest round it, each a little shorter, their crowns
 * overlapping (a ring 0.16 of the height out, as wide as a crown is), their
 * trunks reaching 0.2 below the foot so a stand on a slope doesn't float.
 * What a node at the water's edge gets: a tight clump, as conifers stand
 * at the top of the rock on this coast. The same mesh for every stand of a
 * species and size (instanced).
 */
export const STAND_HEIGHTS = Object.freeze([0.82, 0.9, 0.74, 0.86, 0.78]);
/** Where a stand's lowest crown starts, at most (of its height): conifers at the water keep their branches nearly to the ground. */
export const STAND_BASE = 0.07;
export function standMesh(name, crowns) {
  const s = soup();
  // a stand's crowns reach down to a metre or two over the rock (no bare "lollipop" trunks at the shore)
  const one = treeMesh(name, -0.2, STAND_BASE);
  const P = one.positions, C = one.colors;
  const place = (dx, dz, k, turn) => {
    const c = dcos(turn), sn = dsin(turn);
    const at = (v) => [dx + (P[v] * c - P[v + 2] * sn) * k, P[v + 1] * k, dz + (P[v] * sn + P[v + 2] * c) * k];
    for (let v = 0; v < P.length; v += 9) s.tri(at(v), at(v + 3), at(v + 6), [C[v], C[v + 1], C[v + 2]]);
  };
  place(0, 0, 1, 0);
  for (let q = 0; q < crowns - 1; q++) {
    const a = (q * 2 * Math.PI) / (crowns - 1) + 0.4;
    place(0.16 * dcos(a), 0.16 * dsin(a), STAND_HEIGHTS[q % STAND_HEIGHTS.length], a * 3);
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

/** How far from its node a tree's trunk can stand, in cells: treesAt jitters it under 0.45 of a cell each way. */
export const JITTER = 0.45;
export const TREE_REACH = JITTER * Math.SQRT2;

/**
 * The nodes built on (1): inside a footprint (a ring of [x, z]) or within
 * `reach` metres of its edge. By default `reach` is as far as a tree's
 * trunk can stand from its node, so a node that isn't built on can't put a
 * tree on a footprint; and as the forest roof needs a node and its eight
 * neighbours all forest, its nearest node is two cells from anything built.
 */
export function builtMask(grid, rings, reach = TREE_REACH * grid.cell) {
  const { n, cell, x0, z0 } = grid;
  const out = new Uint8Array(n * n);
  const r2 = reach * reach;
  for (const pts of rings) {
    if (!pts || pts.length < 3) continue;
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (const [x, z] of pts) (xmin = Math.min(xmin, x)), (xmax = Math.max(xmax, x)), (zmin = Math.min(zmin, z)), (zmax = Math.max(zmax, z));
    const i0 = Math.max(0, Math.ceil((xmin - reach - x0) / cell)), i1 = Math.min(n - 1, Math.floor((xmax + reach - x0) / cell));
    const j0 = Math.max(0, Math.ceil((zmin - reach - z0) / cell)), j1 = Math.min(n - 1, Math.floor((zmax + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (out[k]) continue;
        const x = x0 + i * cell, z = z0 + j * cell;
        if (insideRing(pts, x, z) || nearRing(pts, x, z, r2)) out[k] = 1;
      }
    }
  }
  return out;
}

/** Whether (x, z) is within √r2 of a ring's edge. */
function nearRing(pts, x, z, r2) {
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, za] = pts[b], [xb, zb] = pts[a];
    const dx = xb - xa, dz = zb - za, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - xa) * dx + (z - za) * dz) / l2)) : 0;
    const ex = xa + dx * t - x, ez = za + dz * t - z;
    if (ex * ex + ez * ez <= r2) return true;
  }
  return false;
}

/**
 * The canopy each node stands for (metres): the lidar's where `measured`,
 * else the assumed height where OSM says wood (or scrub), else 0; 0 where
 * `built` (builtMask). The assumed height varies ±20% by node.
 */
export function effectiveCanopy({ n, label, cover, canopy = null, measured = null, assumed = { wood: 18, scrub: 3 }, built = null }) {
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (label[k] <= 0 || built?.[k]) continue;
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
 * Each node's distance (metres) beyond the nearest of `circles` ([{ x, z,
 * radius }] in the frame): negative inside one (how far in from its rim),
 * Infinity with none. What a place's `trees.bands` measure, so a tree's
 * detail falls off with its distance from where people look from (the
 * harbour): a function of the node's position alone.
 */
export function beyondCircles(grid, circles) {
  const { n, cell, x0, z0 } = grid;
  const out = new Float32Array(n * n).fill(Infinity);
  if (!circles?.length) return out;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    let b = Infinity;
    for (const c of circles) b = Math.min(b, Math.hypot(x - c.x, z - c.z) - c.radius);
    out[j * n + i] = b;
  }
  return out;
}

/**
 * Whether forest node k gets a stand (`trees.stands` crowns) rather than a
 * tree or two: at the water (within the fringe), not a bog's, and, where the
 * place has `bands`, no further beyond its circles than `bands.stands`.
 */
export function standHere(k, { cover, dist, trees, beyond = null }) {
  if (!trees.stands || dist[k] > (trees.fringeWidth ?? 40) || cover[k] === COVER.wetland) return false;
  return !trees.bands || !beyond || beyond[k] <= (trees.bands.stands ?? 0);
}

/** Whether a forest node in the skin's zone is the skin's (a clump of crowns, skinAt), not trees': where the skin covers `all` the forest, every forest node there but a stand's. */
const skinTakes = (k, { zone, trees, cover, dist, beyond }) => !!(zone?.[k] && trees.skin?.all && !standHere(k, { cover, dist, trees, beyond }));

/**
 * The trees standing on nodes [k0, k1) (all of them by default): each
 * { k, t, species, x, z, height, yaw, girth, key } before any thinning.
 * Where the place has `bands` ({ stands, edges, fringe }: metres beyond its
 * circles, `beyond`), the detail falls off with that distance: stands only
 * within `stands`, the roof's edge trees within `edges`, the fringe's
 * single trees within `fringe`, and beyond that the roof alone; and where
 * the skin covers `all` the forest in its zone (`zone`), the clumps stand
 * there instead of trees (but for the stands).
 * @param {object} o  { grid, label, cover, canopy (effective), dist (to water), trees (the place's look.trees), built? (builtMask: no tree there), zone? (skinZone), beyond? (beyondCircles) }
 */
export function treesAt({ grid, label, cover, canopy, dist, trees, built = null, zone = null, beyond = null }, k0 = 0, k1 = grid.n * grid.n) {
  const { n, cell, x0, z0 } = grid;
  const fringe = trees.fringeWidth ?? 40;
  const setback = trees.roofSetback ?? 20;
  const roof = (k) => isRoof(k, { n, label, cover, canopy, dist, setback });
  const town = (trees.townPerHectare ?? 25) * (cell * cell) / 1e4;
  const out = [];
  for (let k = k0; k < k1; k++) {
    if (label[k] <= 0 || NO_TREES.has(cover[k]) || built?.[k]) continue;
    const i = k % n, j = (k - i) / n;
    const forest = isForest(k, label, cover, canopy);
    let mix = null, count = 0, h = 0, crowns = 1;
    if (forest) {
      // at the roof's edge: not under it, or next to a node that isn't
      const edge = !roof(k) || around(n, k).some((m) => !roof(m));
      if (dist[k] > fringe && !edge) continue;
      if (skinTakes(k, { zone, trees, cover, dist, beyond })) continue;
      if (trees.bands && beyond && beyond[k] > (dist[k] <= fringe ? trees.bands.fringe ?? Infinity : trees.bands.edges ?? Infinity)) continue;
      mix = cover[k] === COVER.wetland ? trees.wetland : dist[k] <= fringe ? trees.fringe : trees.inland;
      count = 1 + (hash01(k, 1) < (trees.second ?? 0.5) ? 1 : 0);
      h = canopy[k];
      // at the water, a stand of `stands` crowns (lo to hi, by hash) where the place has them: one, not one or two
      if (standHere(k, { cover, dist, trees, beyond })) {
        const [lo, hi] = trees.stands;
        crowns = lo + Math.min(hi - lo, Math.floor(hash01(k, 5) * (hi - lo + 1)));
        count = 1;
      }
    } else if (townTreeAt(k, cover, town)) {
      mix = trees.town;
      // a whole tree a node for every full one the density gives, and one more by the rest's chance
      count = Math.max(1, Math.floor(town) + (hash01(k, 3) < town - Math.floor(town) ? 1 : 0));
      h = trees.townHeight ?? 12;
    } else continue;
    for (let t = 0; t < count; t++) {
      const species = pick(mix ?? trees.inland, hash01(k, 10 + t));
      if (!species) continue;
      const height = Math.min(55, Math.max(3, h * (0.85 + 0.3 * hash01(k, 20 + t))));
      // leaning: a stand at the water toward the water (down the distance's slope), 8 to 12°; any other tree up to 6° by hash
      const a = hash01(k, 72 + t) * Math.PI * 2;
      let lean = [TREE_LEAN.any * hash01(k, 70 + t), dcos(a), dsin(a)];
      if (crowns > 1 || (forest && dist[k] <= fringe)) {
        const d = (di, dj) => { const ii = Math.max(0, Math.min(n - 1, i + di)), jj = Math.max(0, Math.min(n - 1, j + dj)); return dist[jj * n + ii]; };
        const gx = d(1, 0) - d(-1, 0), gz = d(0, 1) - d(0, -1);
        // toward the water: against the distance's gradient
        if (gx || gz) lean = [TREE_LEAN.shore[0] + (TREE_LEAN.shore[1] - TREE_LEAN.shore[0]) * hash01(k, 74 + t), -gx / len(gx, gz), -gz / len(gx, gz)];
      }
      out.push({
        k,
        t,
        species,
        lean,
        x: x0 + (i + (hash01(k, 30 + t) - 0.5) * (2 * JITTER)) * cell,
        z: z0 + (j + (hash01(k, 40 + t) - 0.5) * (2 * JITTER)) * cell,
        height,
        yaw: hash01(k, 50 + t) * Math.PI * 2,
        girth: 0.9 + 0.2 * hash01(k, 60 + t),
        ...(crowns > 1 ? { crowns } : {}),
        // the fringe at the water first, then the rest: thinning keeps the lowest keys
        key: (forest && dist[k] <= fringe ? 0 : 1) + hash01(k * 4 + t, 99),
      });
    }
  }
  return out;
}

/** Whether a town lot's node k (not built on, not forest) gets a tree or more: its hash under the town's trees a node (`town`: the look's townPerHectare over a cell's area). */
export const townTreeAt = (k, cover, town) => cover[k] === COVER.residential && hash01(k, 2) < town;

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
 * edge dives into the ground; where `under` (the skin's zone) the roof at
 * `depth` of the canopy, the skin's crowns standing out of it.
 * → { positions, normals?, colors, indices, roofNodes } (no normals: computed by the caller).
 */
export function forestRoof({ grid, heights, label, cover, canopy, dist, setback = 20, tolerance = 4, floor = -80, colours = ["#16231a", "#1d2c1b", "#263524", "#34432a", "#2c3b33"], jitter = 0, under = null, depth = 0.7, mottle = MOTTLE }) {
  const { n } = grid;
  const N = n * n;
  const roof = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (isRoof(k, { n, label, cover, canopy, dist, setback })) roof[k] = 1;
  return sheetOver({ grid, heights, mask: roof, tolerance, floor, colours, jitter, seeds: [77, 79], mottle }, (k) => {
    const i = k % n, j = (k - i) / n;
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const m = jj * n + ii;
      if (roof[m]) (s += canopy[m]), c++;
    }
    // under the skin's crowns (`under`: its zone), the roof sits at `depth` of the canopy, so the crowns stand out of it as cones, not tips
    return heights[k] + (s / c) * (under?.[k] ? depth : 1);
  });
}

/** The colours of the low scrub (salal and shore pine) where the lidar's canopy is under 5 m: a place's `trees.scrub.colours` overrides them. */
export const SCRUB_COLOURS = Object.freeze(["#3e4a2c", "#37432a", "#44502f", "#333f27", "#3b4630"]);

/** What low scrub grows on: wild ground (nothing mapped, wood, scrub, wetland), not lots, lawns or yards. */
const WILD = new Set([COVER.none, COVER.wood, COVER.scrub, COVER.wetland]);

/** Whether node k is low scrub: wild land (WILD), not built, `setback` from the water, its canopy from `min` to 5 m (forest above). */
export const isScrub = (k, { label, cover, canopy, dist, built = null, setback = 20, min = 0.8 }) => label[k] > 0 && !built?.[k] && WILD.has(cover[k]) && dist[k] > setback && canopy[k] >= min && canopy[k] <= 5;

/**
 * The low scrub: salal and shore pine, where the lidar says the canopy is
 * under 5 m (Amphitrite's headland, Ozzard's upper slopes): not turf, a
 * bumpy low skin over the ground, its canopy's height (at least `lift`)
 * and ±`jitter` by hash, the same RTIN as the roof, its edge just under the
 * ground. → as forestRoof (roofNodes: the scrub's nodes), or null. Where
 * `fine` ({ zone, tolerance }: the skin's zone) the RTIN is finer, so the
 * sheet near where people look isn't a few large facets.
 */
export function scrubCover({ grid, heights, label, cover, canopy, dist, built = null, setback = 20, min = 0.8, lift = 1, tolerance = 0.6, floor = -80, colours = SCRUB_COLOURS, jitter = 1.5, fine = null, mottle = MOTTLE }) {
  const N = grid.n * grid.n;
  const mask = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (isScrub(k, { label, cover, canopy, dist, built, setback, min })) mask[k] = 1;
  return sheetOver({ grid, heights, mask, tolerance, floor, colours, jitter, seeds: [87, 89], fine, mottle }, (k) => heights[k] + Math.max(lift, canopy[k]));
}

/** How much a sheet's vertex colour varies in value by hash, either way (forestRoof, scrubCover): no facet one flat tone. */
export const MOTTLE = 0.15;

/**
 * A sheet over the ground at `mask`'s nodes (their height topOf(k)): an RTIN
 * (tolerance `tolerance` there, 0.5 at the ring round it, which is just under
 * the ground so the sheet's edge dives into it; every other node far down
 * at `floor` and the triangles with no mask node dropped), each mask node
 * up or down by its own hash (±jitter), coloured by another (seeds: [colour,
 * jitter]) and mottled ±`mottle` in value by a third; where `fine` ({ zone,
 * tolerance }) its zone's nodes at that tolerance. Null if the mask is empty.
 */
function sheetOver({ grid, heights, mask, tolerance, floor, colours, jitter, seeds: [colourSeed, jitterSeed], fine = null, mottle = 0 }, topOf) {
  const { n, cell, x0, z0 } = grid;
  const N = n * n;
  const roof = mask;
  let count = 0;
  for (let k = 0; k < N; k++) if (roof[k]) count++;
  if (!count) return null;
  const top = new Float32Array(N), tol = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    tol[k] = fine?.zone?.[k] ? fine.tolerance : tolerance;
    if (!roof[k]) {
      // the ring round the roof just under the ground (so its edge slopes down over a cell); everything else far down, flat
      top[k] = around(n, k).some((m) => roof[m]) ? heights[k] - 1 : floor;
      if (top[k] !== floor) tol[k] = 0.5;
      continue;
    }
    top[k] = topOf(k);
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
    // a roof node a little up or down by its own hash (±jitter): crowns, not turf
    positions[q * 3 + 1] = top[k] + (roof[k] && jitter ? (hash01(k, jitterSeed) - 0.5) * 2 * jitter : 0);
    positions[q * 3 + 2] = z0 + j * cell;
    const u = hash01(k, colourSeed);
    const c = lin[u < 0.25 ? 0 : u < 0.55 ? 1 : u < 0.8 ? 2 : u < 0.9 ? 3 : 4];
    const f = 1 + mottle * (2 * hash01(k, colourSeed + 1000) - 1);
    colors[q * 3] = c[0] * f;
    colors[q * 3 + 1] = c[1] * f;
    colors[q * 3 + 2] = c[2] * f;
  });
  const indices = Uint32Array.from(tris, (v) => used[v]);
  return { positions, colors, indices, roofNodes: count };
}

// ─── the forest's skin ──────────────────────────────────────────────────────
//
// From the water the roof alone is a smooth dark hill: its ridgelines and
// shores are curves. Where the place says people look from close by (its
// look's `trees.skin.within`: circles in the frame), every roof node gets a
// clump of crowns standing out of the roof, so the forest's edge against
// the sky is serrated, as a conifer forest's is. The roof stays under them
// as the dark underlayer. A clump is one instance (the scene draws each
// clump mesh as one InstancedMesh): `crowns` cheap crowns (12 triangles
// each: two six-sided cones, a wide one and a narrow one over it), laid out
// in the node's cell by one of SKIN_LAYOUTS, their tops at the node's
// canopy ±8%. Every choice is the node's index and its data, so the skin
// of a grid is the union of its tiles' (tested by enumeration).
//
// The canopy is closed from above: a clump is turned only by quarter turns
// and never shrunk (width 1 to 1.12), and its crowns are wide enough
// (SKIN_PROFILES radius) that at least 90% of every cell lies under some
// crown's foot, with any layouts round it (tested by enumeration). Two
// silhouettes of this coast stand out of it, keyed by the layout a node's
// hash picks: about one crown in ten a lighter Sitka spruce, 15% taller,
// and about one in thirty a dead snag, a thin grey spike over the canopy.

/**
 * Where a clump's crowns stand in its cell (fractions of a cell from the
 * node), how tall each is (of the clump's height), and its signature, if
 * any ("spruce", "snag": a snag stands at [u, v] beside the crowns): four
 * layouts of 3 crowns and four of 4, each kind's last its snag's. 4-crown
 * layouts are near-square so a roof's cell closes under any quarter turn.
 */
export const SKIN_LAYOUTS = Object.freeze({
  3: Object.freeze([
    [[-0.3, -0.2, 1], [0.3, -0.14, 0.9], [0.02, 0.3, 0.95]],
    [[-0.28, 0.24, 0.92], [0.3, 0.2, 1, "spruce"], [0.0, -0.3, 0.88]],
    [[-0.3, 0.0, 0.95], [0.18, -0.28, 0.9], [0.22, 0.28, 1]],
    [[-0.26, -0.26, 1], [0.3, 0.02, 0.9], [-0.16, 0.3, 0.94], [0.06, -0.04, 1, "snag"]],
  ].map((l) => Object.freeze(l.map((c) => Object.freeze(c))))),
  4: Object.freeze([
    [[-0.25, -0.25, 1], [0.25, -0.25, 0.88], [-0.25, 0.25, 0.93], [0.25, 0.25, 0.97]],
    [[-0.28, -0.2, 0.9], [0.22, -0.28, 1], [-0.22, 0.28, 0.94, "spruce"], [0.28, 0.2, 0.86]],
    [[-0.2, -0.3, 0.95], [0.3, -0.22, 1], [-0.3, 0.2, 0.87], [0.2, 0.28, 0.92]],
    [[-0.27, -0.24, 1], [0.25, -0.2, 0.9, "spruce"], [-0.24, 0.24, 0.95], [0.2, 0.3, 0.88], [0.02, 0.0, 1, "snag"]],
  ].map((l) => Object.freeze(l.map((c) => Object.freeze(c))))),
});
/** How often a node's hash picks each layout (by index): the snag's least, so about one crown in thirty is a snag. */
export const LAYOUT_WEIGHTS = Object.freeze({ 3: Object.freeze([1, 1, 1, 0.45]), 4: Object.freeze([1, 1, 1, 0.55]) });
/** A layout's crowns: its entries but a snag. */
export const crownsOf = (layout) => layout.filter((c) => c[3] !== "snag");
/** The crowns' colours: the coast's forest dark and blue-green; a place's `trees.skin.colours` overrides them. Each crown ±12% in value by hash. */
export const SKIN_COLOURS = Object.freeze(["#16241c", "#1c2b22", "#22301f", "#131e17", "#2a3a2c"]);
/** A Sitka spruce's crown, lighter and greyer than the hemlock and cedar round it, and how much taller it stands. */
export const SPRUCE = Object.freeze({ colour: "#36463a", taller: 1.15 });
/** A dead snag: a thin grey spike from `from` of the clump's height to `top` (3–6 m over a 20–30 m canopy), `radius` metres at its foot. */
export const SNAG = Object.freeze({ colour: "#8f8b83", from: 0.5, top: 1.18, radius: 0.4 });
/** How much a crown's colour varies in value by hash, either way. */
export const CROWN_VALUE = 0.12;
/** A crown's radius in metres, and where it starts and its narrow tier starts and ends (of the clump's height). */
export const SKIN_CROWN = Object.freeze({ radius: 6.5, foot: 0.55, waist: 0.86, upper: 0.72, tip: 1, crowns: Object.freeze([4, 4]) });

/**
 * A clump's crown profiles: `roof`, standing out of the forest roof (its
 * foot hidden in it), always four crowns; `low`, a whole conifer down to a
 * metre or so over the ground, where the forest is too patchy for a roof
 * (second growth among the lots, the edges of clearings); `scrub`, four
 * squat round-shouldered bushes, shore pine and salal, where the canopy is
 * 1 to 5 m, a lumpy dark mass over the scrub's sheet. Fractions of the
 * clump's height; radius in metres; `crowns`, the profile's own count (else
 * the place's skin.crowns).
 */
export const SKIN_PROFILES = Object.freeze({
  roof: SKIN_CROWN,
  low: Object.freeze({ radius: 8.5, foot: 0.06, waist: 0.8, upper: 0.55, tip: 1 }),
  scrub: Object.freeze({ radius: 6, foot: 0, waist: 0.85, upper: 0.45, tip: 1, crowns: Object.freeze([4, 4]), plain: true }),
});
/** The skin's profiles in the order their meshes are made. */
export const PROFILE_NAMES = Object.freeze(Object.keys(SKIN_PROFILES));
/** A crown's radius against its profile's: 0.92 to 1.08, by its place in the layout. */
export const crownRadius = (profile, q, variant) => SKIN_PROFILES[profile].radius * (0.92 + 0.16 * ((q * 0.37 + variant * 0.21) % 1));

/**
 * The crowns' shapes (the skin's, but the scrub's plain bushes): three of
 * the coast's conifers, each a stack of six-sided cones, its tiers' feet
 * and tips as fractions of the crown's span (its profile's foot to its tip)
 * and their radii of the crown's, the lowest tier always centred and as
 * wide as the crown (so the canopy still closes from above), the ones over
 * it pushed off the axis by up to `offset` of the radius by hash, so no two
 * crowns of a layout stand quite alike and the silhouette is ragged:
 * - western red cedar: three stacked frusta, 1, 0.72 and 0.4 of the radius,
 *   its leader bent over (its tip `bend` of the top tier's radius off the
 *   axis);
 * - western hemlock: narrower tiers over a full skirt, its tip drooping
 *   (`bend` off the axis and `droop` of the span lower);
 * - Sitka spruce: four short, flat tiers, stiff and tiered.
 * Each tier is 6 triangles: 18 for a cedar, 24 for a hemlock or a spruce.
 * Each vertex is coloured by its height in the crown, CROWN_SHADE[0] of its
 * colour at the foot to CROWN_SHADE[1] at the tip, so the gaps between
 * crowns read as shadow, and its faces toward the light a little lighter.
 */
export const CROWN_SHAPES = Object.freeze({
  cedar: Object.freeze({ tiers: Object.freeze([[0, 0.62, 1], [0.3, 0.86, 0.72], [0.6, 1, 0.4]]), offset: 0.08, bend: 0.45, droop: 0 }),
  hemlock: Object.freeze({ tiers: Object.freeze([[0, 0.5, 1], [0.26, 0.7, 0.62], [0.48, 0.88, 0.44], [0.7, 1, 0.26]]), offset: 0.06, bend: 0.7, droop: 0.05 }),
  spruce: Object.freeze({ tiers: Object.freeze([[0, 0.38, 1], [0.26, 0.6, 0.8], [0.48, 0.8, 0.58], [0.7, 1, 0.34]]), offset: 0.05, bend: 0, droop: 0 }),
});
/** A crown's shade from its foot to its tip (of its colour). */
export const CROWN_SHADE = Object.freeze([0.55, 1]);
/** How many triangles a crown of a shape is (6 a tier), and the scrub's plain bush (two six-sided cones). */
export const crownTriangles = (shape) => (shape ? CROWN_SHAPES[shape].tiers.length * 6 : 12);
/** The shape of crown q of layout `variant` of `crowns` (its sign the layout's): a spruce where the layout says, else a cedar or a hemlock by hash; none (a plain bush) for a plain profile. */
export const crownShape = (plain, sign, crowns, variant, q) => (plain ? null : sign === "spruce" ? "spruce" : hash01((crowns * 16 + variant) * 8 + q, 73) < 0.5 ? "cedar" : "hemlock");

/** One crown: of `shape` (CROWN_SHAPES), or a plain bush (null: a wide six-sided cone, foot → waist, and a narrow one over it, upper → tip); no caps (never seen from under the roof). `seed` turns its tiers' offsets. */
function crown(s, cx, cz, k, r, colour, { foot, waist, upper, tip } = SKIN_CROWN, shape = null, seed = 0) {
  const shadeAt = (y) => CROWN_SHADE[0] + (CROWN_SHADE[1] - CROWN_SHADE[0]) * Math.max(0, Math.min(1, (y / k - foot) / (tip - foot)));
  // faces toward the sun's side a little lighter: shading baked in, as the trees' are
  const side = (q) => (q < 2 || q === 5 ? 1.12 : q === 3 ? 0.82 : 1);
  const at = (p, f) => colour.map((c) => c * f * shadeAt(p[1]));
  const cone = (ox, oz, y0, rr, apex, y1) => {
    const ring = (q) => [cx + ox + rr * dcos((q * Math.PI) / 3), y0, cz + oz - rr * dsin((q * Math.PI) / 3)];
    const top = [cx + apex[0], y1, cz + apex[1]];
    for (let q = 0; q < 6; q++) {
      const a = ring(q), b = ring(q + 1), f = side(q);
      s.triC(a, b, top, at(a, f), at(b, f), at(top, f));
    }
  };
  if (!shape) {
    cone(0, 0, foot * k, r, [0, 0], waist * k);
    cone(0, 0, upper * k, r * 0.58, [0, 0], tip * k);
    return;
  }
  const sh = CROWN_SHAPES[shape];
  const span = tip - foot;
  sh.tiers.forEach(([f0, f1, rf], t) => {
    const last = t === sh.tiers.length - 1;
    // the lowest tier centred (the canopy closes on it); those over it off the axis by hash
    const u = t ? (hash01(seed * 8 + t, 74) - 0.5) * 2 * sh.offset * r : 0;
    const w = t ? (hash01(seed * 8 + t, 75) - 0.5) * 2 * sh.offset * r : 0;
    // the leader bent over (and a hemlock's drooping) toward a side the seed picks
    const lean = last && sh.bend ? sh.bend * rf * r : 0;
    const dir = (hash01(seed, 76) * Math.PI * 2);
    const apex = [u + lean * dcos(dir), w - lean * dsin(dir)];
    cone(u, w, (foot + span * f0) * k, rf * r, apex, (foot + span * f1 - (last ? sh.droop * span : 0)) * k);
  });
}

/** A snag: a four-sided grey spike from SNAG.from to SNAG.top of the clump's height (8 triangles). */
function snag(s, cx, cz, colour) {
  const ring = (y, rr, q) => [cx + rr * dcos((q * Math.PI) / 2 + 0.4), y, cz - rr * dsin((q * Math.PI) / 2 + 0.4)];
  for (let q = 0; q < 4; q++) {
    const shade = colour.map((c) => c * (q === 0 ? 1.1 : q === 2 ? 0.8 : 1));
    s.tri(ring(SNAG.from, SNAG.radius, q), ring(SNAG.from, SNAG.radius, q + 1), ring(SNAG.top, 0.06, q + 1), shade);
    s.tri(ring(SNAG.from, SNAG.radius, q), ring(SNAG.top, 0.06, q + 1), ring(SNAG.top, 0.06, q), shade);
  }
}

/** A crown's colour (linear): the layout's pick from `lin`, its value ±CROWN_VALUE by hash; a spruce's its own. */
function crownColour(lin, q, crowns, variant, sign, plain) {
  const base = !plain && sign === "spruce" ? hexToLinear(SPRUCE.colour).slice(0, 3) : lin[(q + variant * 2) % lin.length];
  const f = 1 + CROWN_VALUE * (2 * hash01((crowns * 16 + variant) * 8 + q, 71) - 1);
  return base.map((c) => c * f);
}

/** A clump mesh: layout `variant` of `crowns` crowns in a cell `cell` metres across, unit height (y = 1 is the clump's height), positions in metres across; its crowns of `profile` (SKIN_PROFILES; a plain profile, the scrub's, has no spruce or snag). */
export function skinMesh(crowns, variant, cell, colours = SKIN_COLOURS, profile = "roof") {
  const s = soup();
  const lin = colours.map((c) => hexToLinear(c).slice(0, 3));
  const pr = SKIN_PROFILES[profile];
  let q = 0;
  for (const [u, v, k, sign] of SKIN_LAYOUTS[crowns][variant]) {
    if (sign === "snag") {
      if (!pr.plain) snag(s, u * cell, v * cell, hexToLinear(SNAG.colour).slice(0, 3));
      continue;
    }
    const tall = !pr.plain && sign === "spruce" ? SPRUCE.taller : 1;
    const shape = crownShape(pr.plain, sign, crowns, variant, q);
    crown(s, u * cell, v * cell, k * tall, crownRadius(profile, q, variant), crownColour(lin, q, crowns, variant, sign, pr.plain), pr, shape, (crowns * 16 + variant) * 8 + q);
    q++;
  }
  return s.done();
}

/** The layout a node's hash `u` (in [0, 1)) picks among `crowns`' layouts, by LAYOUT_WEIGHTS. */
export function pickLayout(crowns, u) {
  const w = LAYOUT_WEIGHTS[crowns];
  const total = w.reduce((a, b) => a + b, 0);
  let x = u * total;
  for (let v = 0; v < w.length; v++) {
    if (x < w[v]) return v;
    x -= w[v];
  }
  return w.length - 1;
}

/** The nodes inside any of `circles` ([{ x, z, radius }] in the frame): 1, else 0. */
export function skinZone(grid, circles) {
  const { n, cell, x0, z0 } = grid;
  const out = new Uint8Array(n * n);
  for (const c of circles ?? []) {
    const r2 = c.radius * c.radius;
    const i0 = Math.max(0, Math.ceil((c.x - c.radius - x0) / cell)), i1 = Math.min(n - 1, Math.floor((c.x + c.radius - x0) / cell));
    const j0 = Math.max(0, Math.ceil((c.z - c.radius - z0) / cell)), j1 = Math.min(n - 1, Math.floor((c.z + c.radius - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + i * cell - c.x, dz = z0 + j * cell - c.z;
      if (dx * dx + dz * dz <= r2) out[j * n + i] = 1;
    }
  }
  return out;
}

/** What low scrub clumps stand on: wild ground and the town's lots (not lawns, yards, beaches or rock). */
const SCRUBBY = new Set([COVER.none, COVER.wood, COVER.scrub, COVER.wetland, COVER.residential]);

/**
 * Which clump node k gets, if any: `roof` on a roof node; where the skin
 * covers `all` the forest, `low` on every other forest node, and none on a
 * stand's (standHere: the stand is its crowns); where it has `scrub` ({ min }), `scrub` where the canopy is
 * from min to 5 m on wild ground or a lot. Null otherwise, outside the zone
 * and where built.
 */
export function clumpOf(k, { n, label, cover, canopy, dist, zone, skin, setback = 20, built = null, trees = null, beyond = null }) {
  if (!zone[k] || built?.[k] || label[k] <= 0) return null;
  const forest = isForest(k, label, cover, canopy);
  // where the skin covers all the forest, a stand's node is the stand's alone (the roof reaches into the fringe)
  if (skin.all && forest && trees && standHere(k, { cover, dist, trees, beyond })) return null;
  if (isRoof(k, { n, label, cover, canopy, dist, setback })) return "roof";
  if (skin.all && forest) return "low";
  if (skin.scrub && SCRUBBY.has(cover[k]) && canopy[k] >= (skin.scrub.min ?? 3) && canopy[k] <= 5) return "scrub";
  return null;
}

/**
 * The clumps on nodes [k0, k1): one on every node clumpOf gives one (by
 * default every roof node in `zone`), none where `built`. Each { k, x, z,
 * height, crowns, variant, profile, yaw (a quarter turn), width (1 to 1.12), key }: a roof clump its
 * canopy ±8%, a low one or a scrub one its canopy −8 to +8% (at least 2 m).
 * @param {object} o  { grid, label, cover, canopy (effective), dist, zone (skinZone), skin (the look's trees.skin), setback?, built?, trees? (the look's trees, for its stands), beyond? (beyondCircles) }
 */
export function skinAt(o, k0 = 0, k1 = o.grid.n * o.grid.n) {
  const { grid, canopy, skin } = o;
  const { n, cell, x0, z0 } = grid;
  const out = [];
  for (let k = k0; k < k1; k++) {
    const profile = clumpOf(k, { ...o, n });
    if (!profile) continue;
    const i = k % n, j = (k - i) / n;
    // the profile's own count where it has one (a roof's and the scrub's always four, so the cell closes), else the place's
    const [lo, hi] = SKIN_PROFILES[profile].crowns ?? skin.crowns ?? [3, 4];
    const crowns = lo + Math.min(hi - lo, Math.floor(hash01(k, 82) * (hi - lo + 1)));
    out.push({
      k,
      x: x0 + i * cell,
      z: z0 + j * cell,
      height: Math.max(profile === "roof" ? 0 : 2, canopy[k] * (0.92 + 0.16 * hash01(k, 81))),
      crowns,
      variant: pickLayout(crowns, hash01(k, 83)),
      ...(profile !== "roof" ? { profile } : {}),
      // a quarter turn, and never shrunk (stretched up to 15% on each of x and z by its own hash): neighbouring cells' crowns still interlock and close the canopy
      yaw: Math.floor(hash01(k, 84) * 4) * (Math.PI / 2),
      width: 1 + CLUMP_STRETCH * hash01(k, 85),
      depth: 1 + CLUMP_STRETCH * hash01(k, 87),
      // leaning up to CLUMP_LEAN toward a side by hash: no two clumps stand quite plumb alike
      lean: [CLUMP_LEAN * hash01(k, 88), dcos(hash01(k, 89) * Math.PI * 2), dsin(hash01(k, 89) * Math.PI * 2)],
      key: hash01(k, 86),
    });
  }
  return out;
}

/** How much a clump is stretched, at most, on each of x and z (never shrunk), and how far it leans at most (radians: 6°). */
export const CLUMP_STRETCH = 0.15;
export const CLUMP_LEAN = Math.PI / 30;
/** How far a tree leans (radians): any tree up to `any` toward a side by hash; one at the water's edge (a stand) `shore` toward the water, the sea's wind's lean. */
export const TREE_LEAN = Object.freeze({ any: Math.PI / 30, shore: Object.freeze([(8 * Math.PI) / 180, (12 * Math.PI) / 180]) });

/**
 * The rotation (a quaternion [x, y, z, w]) of a thing turned `yaw` about +Y
 * and then leaned `angle` radians, its top toward the horizontal unit
 * direction (dx, dz), each component to 4 places. Pure.
 */
export function leanYaw(yaw, angle = 0, dx = 1, dz = 0) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4 + 0;
  const sy = dsin(yaw / 2), cy = dcos(yaw / 2);
  if (!angle) return [0, r4(sy), 0, r4(cy)];
  // the axis the lean turns about: up × the lean's direction (dx, 0, dz)
  const ax = dz, az = -dx;
  const s = dsin(angle / 2), c = dcos(angle / 2);
  return [r4(cy * ax * s - az * s * sy), r4(c * sy), r4(cy * az * s + ax * s * sy), r4(c * cy)];
}

/** Every clump in the grid, thinned to the skin's `max` by each clump's own key (the lowest kept). */
export function placeSkin(o) {
  const all = skinAt(o);
  const max = o.skin.max ?? Infinity;
  if (all.length <= max) return { clumps: all, threshold: 1, before: all.length };
  const threshold = all.map((c) => c.key).sort((a, b) => a - b)[max - 1];
  return { clumps: all.filter((c) => c.key <= threshold), threshold, before: all.length };
}

/** The GLB meshes for the clumps (one a size and layout) and a node per clump, its foot on the ground at its node. */
export function skinInstances(clumps, groundAt, { meshBase, cell, colours = SKIN_COLOURS, scrubColours = SCRUB_COLOURS } = {}) {
  // a kind a profile, size and layout ("3/1", the roof's, as before; "low:4/2")
  const kindOf = (t) => `${t.profile ? `${t.profile}:` : ""}${t.crowns}/${t.variant}`;
  const kinds = [];
  for (const p of PROFILE_NAMES) for (const c of [3, 4]) for (let v = 0; v < SKIN_LAYOUTS[c].length; v++) {
    const key = `${p === "roof" ? "" : `${p}:`}${c}/${v}`;
    if (clumps.some((t) => kindOf(t) === key)) kinds.push([p, c, v, key]);
  }
  const what = { roof: "Forest skin", low: "Forest (low crowns)", scrub: "Shore pine and salal" };
  const meshes = kinds.map(([p, c, v]) => {
    const m = skinMesh(c, v, cell, p === "scrub" ? scrubColours : colours, p);
    return { name: `${what[p]} (${c} crowns, layout ${v + 1})`, positions: m.positions, colors: m.colors, roughness: 1 };
  });
  const index = new Map(kinds.map(([, , , key], q) => [key, meshBase + q]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  // a low or scrub clump's foot sunk CLUMP_SINK into the ground (its crowns reach out over a slope), its top where it was
  const sink = (t) => (t.profile ? CLUMP_SINK : 0);
  const nodes = clumps.map((t) => ({ mesh: index.get(kindOf(t)), translation: [r2(t.x), r2(groundAt(t.x, t.z) - sink(t)), r2(t.z)], rotation: leanYaw(t.yaw, ...(t.lean ?? [])), scale: [r2(t.width), r2(t.height + sink(t)), r2(t.depth ?? t.width)] }));
  return { meshes, nodes, kinds: kinds.map(([, , , key]) => key) };
}
/** How far a low or scrub clump's foot is sunk into the ground (m), so its crowns don't float over a slope. */
export const CLUMP_SINK = 1.5;

/**
 * Instances cut into tiles: every instanced mesh again (`sameAs`: the same
 * bytes) for each tile its nodes fall in after the first, so a renderer that
 * draws a mesh's nodes as one instanced draw and culls it by its bounds
 * (scene's collapseInstances, three's frustum culling) culls a tile at a
 * time, not a forest 20 km across. `tileOf(q)` is node q's tile (any key);
 * tiles are taken in the order their first node comes, so the cut is a
 * function of the nodes. The nodes keep their order; each points at its
 * mesh's copy for its tile. Meshes [meshBase, meshBase + meshCount) are the
 * instanced ones; the copies go after them.
 * @returns {{ meshes: { name, sameAs }[], nodes: object[], tiles: number }}
 */
export function tileInstances(nodes, { meshBase, meshCount, names = [] }, tileOf) {
  const copies = new Map(); // `${mesh}|${tile}` → mesh index
  const first = new Map(); // mesh → its first tile
  const meshes = [];
  const tiles = new Set();
  const out = nodes.map((nd, q) => {
    const tile = tileOf(q);
    tiles.add(tile);
    const m = nd.mesh;
    if (!first.has(m)) first.set(m, tile);
    if (first.get(m) === tile) return nd;
    const key = `${m}|${tile}`;
    if (!copies.has(key)) {
      copies.set(key, meshBase + meshCount + meshes.length);
      meshes.push({ name: `${names[m - meshBase] ?? "Instances"} (tile ${tile})`, sameAs: m });
    }
    return { ...nd, mesh: copies.get(key) };
  });
  return { meshes, nodes: out, tiles: tiles.size };
}

/** The GLB meshes for the trees' species, and a node per tree (instanced by the scene: one draw a species). */
export function treeInstances(trees, groundAt, sinkAt, { meshBase, layer = "forest" } = {}) {
  // a mesh a species, and one a species and stand size: each tree's kind
  const kindOf = (t) => (t.crowns > 1 ? `${t.species}×${t.crowns}` : t.species);
  const kinds = new Set(trees.map(kindOf));
  const sizes = [...new Set(trees.map((t) => t.crowns ?? 1))].sort((a, b) => a - b);
  const species = [];
  for (const c of sizes) for (const s of SPECIES_NAMES) if (kinds.has(c > 1 ? `${s}×${c}` : s)) species.push(c > 1 ? `${s}×${c}` : s);
  const meshes = species.map((kind) => {
    const [s, c] = kind.split("×");
    const m = c ? standMesh(s, Number(c)) : treeMesh(s);
    return { name: c ? `Stand of ${c} (${s})` : `Tree (${s})`, positions: m.positions, colors: m.colors, roughness: 0.95 };
  });
  const index = Object.fromEntries(species.map((s, q) => [s, meshBase + q]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const nodes = trees.map((t) => {
    const g = groundAt(t.x, t.z);
    const sink = sinkAt(g);
    const h = t.height + sink;
    const yaw = t.yaw;
    return { mesh: index[kindOf(t)], translation: [r2(t.x), r2(g - sink), r2(t.z)], rotation: leanYaw(yaw, ...(t.lean ?? [])), scale: [r2(h * t.girth), r2(h), r2(h * t.girth)] };
  });
  return { meshes, nodes, species, layer };
}
