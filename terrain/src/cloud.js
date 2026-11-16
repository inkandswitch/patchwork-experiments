// Low cloud caught on the hills (README, "The look"): weather dressing, not
// data. On most summer afternoons at Ucluelet the overcast sits on the
// ridges: stratus at a few hundred metres torn on Mount Ozzard and the
// Mackenzie Range, mist lying in the forest's hollows. The sky's fog is
// uniform with distance and can't show that, so the place draws it, from
// its own heights and its look's `clouds`:
//
// - sheets: for each level, the grid is walked every `every` nodes; where
//   the ground there is within `below` under the level and `above` over it
//   (a slope the cloud base meets), and the node's hash passes `chance`, a
//   bank `size` metres across lies at the level, ± a few metres by hash;
// - mist: the same walk over the forest's hollows (a node lower than the
//   mean of the ring `every` nodes round it by at least `hollow`), a thin
//   bank `lift` metres over the canopy;
// - bake: where the place asks, stratus baked into the ground's and the
//   forest roof's colours above a height (bakeStratus): no sheet at all;
// - caps: where the place names one (its look's clouds.caps: a summit), a
//   bank wrapped round it `below` metres under the top (Mount Ozzard's,
//   under the radome).
//
// A bank is a lens, not a flat sheet: a flat sheet seen from the water, a
// few degrees under it, is a thin pale stripe across the hill, like a
// contour line. A lens has a body: its top domes `thick` metres over its
// base at the middle and its underside sags a third of that, both thinning
// to nothing at the rim; the rim is ragged, its radius by a smoothed hash
// a sector (0.6 to 1 of the bank's half-size), and the alpha falls to 0 at
// every rim and wherever the ground is less than `clear` under it (so a
// bank never shows as a hard line cut into the hillside, it thins into it).
//
// Every bank is a function of its node (or its cap) and the heights round
// it, and nothing else (tested: tile by tile is the whole). One indexed mesh
// with RGBA colours, each bank two surfaces, drawn unlit and blended.
//
// Pure.

import { hash01 } from "./palette.js";
import { hexToLinear } from "./glb.js";
import { dsin, dcos, len } from "./detmath.js";

export const CLOUDS = Object.freeze({
  colour: "#d3d9d9",
  sheets: { levels: [380], every: 14, below: 110, above: 40, chance: 0.3, size: 900, alpha: 0.5, clear: 15, thick: 70 },
  mist: { every: 10, hollow: 25, chance: 0.25, size: 380, lift: 12, alpha: 0.32, clear: 6, thick: 18 },
  caps: [],
});

/** Whether (x, z) is inside any of `circles` ([{ x, z, radius }] in the frame); anywhere without any. */
const within = (circles, x, z) => !circles?.length || circles.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.radius * c.radius);

/**
 * Stratus baked into colours (a place's clouds.bake): from `from` metres up,
 * every vertex lerped toward `colour` by the band's factor at its height
 * (stratusAt) and where it is. The colour is the one the sky's horizon reads
 * as once lit (darker than the horizon's own: lit by the sky and the sun a
 * hill comes out lighter than its colour), so a summit never shows brighter
 * than the sky behind it, as snow. Where it is:
 *
 * - with `wisps` (WISPS), the band is torn into wisps lying along the
 *   slopes: a coarse value noise (wispAt: two octaves, their cells
 *   `cells` metres across, `stretch` times finer in height than across, so
 *   on a hillside a wisp runs along the contour and is cut across it),
 *   thresholded so that about `cover` of the band takes the band's whole
 *   factor and the rest at most `floor` of it, letting the dark forest show
 *   between; and with `low` ({ from, peak, span, max, above, within:
 *   circles in the frame }) a weaker band of mist low on the hills, only in
 *   its circles, torn by the same noise;
 * - without, ± `noise` of the factor by a hash of where it is (to the
 *   metre).
 *
 * In place; returns how many vertices it touched. Pure but for `colors`.
 * @param {Float32Array} positions  xyz
 * @param {Float32Array} colors  rgb (linear), as many
 */
export function bakeStratus(positions, colors, o = {}) {
  const fog = hexToLinear(o.colour ?? "#959ea1").slice(0, 3);
  let touched = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const t = stratusFactor(x, y, z, o);
    if (t === null) continue;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] += (fog[c] - colors[v * 3 + c]) * t;
    touched++;
  }
  return touched;
}

/** How a band of stratus is torn into wisps (bakeStratus): the noise's cells (m), how much finer in height, each octave's weight, the share of the band at its whole factor, and the most the rest take of it. */
export const WISPS = Object.freeze({ cells: Object.freeze([350, 120]), stretch: 3, weights: Object.freeze([0.65, 0.35]), cover: 0.4, floor: 0.25 });
/** The noise's levels between which a wisp goes from the floor to whole: chosen so that `cover` of the noise is over the upper one (cloud.test.js measures it over a grid). */
export const WISP_EDGES = Object.freeze([0.505, 0.54]);

/** A value noise in [0, 1] at (x, y, z) in cells: a hash at each lattice point, smoothly interpolated. Pure. */
function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const sm = (t) => t * t * (3 - 2 * t);
  const u = sm(x - xi), w = sm(y - yi), s = sm(z - zi);
  const h = (a, b, c) => hash01((Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0, seed);
  const lerp = (a, b, t) => a + (b - a) * t;
  const plane = (c) => lerp(lerp(h(xi, yi, c), h(xi + 1, yi, c), u), lerp(h(xi, yi + 1, c), h(xi + 1, yi + 1, c), u), w);
  return lerp(plane(zi), plane(zi + 1), s);
}

/** The wisps' noise at a point (x, y, z in metres): WISPS' octaves, in [0, 1]. Pure. */
export function wispAt(x, y, z, o = WISPS) {
  let n = 0;
  o.cells.forEach((c, q) => (n += o.weights[q] * valueNoise3(x / c, (y * o.stretch) / c, z / c, 97 + q)));
  return n;
}

/** How much of the band a point takes, by the wisps' noise there: `floor` under WISP_EDGES[0], 1 over WISP_EDGES[1], smoothly between. Pure. */
export function wispShare(x, y, z, o = WISPS) {
  const t = Math.max(0, Math.min(1, (wispAt(x, y, z, o) - WISP_EDGES[0]) / (WISP_EDGES[1] - WISP_EDGES[0])));
  return o.floor + (1 - o.floor) * t * t * (3 - 2 * t);
}

/** The stratus's factor at a point for a place's bake (bakeStratus), or null where it touches nothing. Pure. */
export function stratusFactor(x, y, z, o = {}) {
  const from = o.from ?? 250, max = o.max ?? 0.85;
  const low = o.low && o.wisps && (o.low.within ?? []).some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.radius * c.radius) ? o.low : null;
  if (y <= from && !(low && y > low.from)) return null;
  if (o.wisps) {
    const wisps = { ...WISPS, ...(o.wisps === true ? {} : o.wisps) };
    const share = wispShare(x, y, z, wisps);
    const band = Math.min(max, stratusAt(y, o)) * share;
    return Math.max(band, low ? Math.min(low.max, stratusAt(y, low)) * share : 0);
  }
  const u = hash01((Math.imul(Math.round(x), 73856093) ^ Math.imul(Math.round(z), 19349663)) >>> 0, 96);
  const noise = o.noise ?? 0.3;
  return Math.max(0, Math.min(max, stratusAt(y, o) * (1 + (u - 0.5) * 2 * noise)));
}

/**
 * The stratus's share at height y (before the noise): with a `peak`, a band
 * (cloud lies across the hills, their tops in and out of it): 0 at `from`,
 * rising (smoothly) to `max` at `peak`, easing back to `above` over the
 * next `span` metres and holding there; without, a ramp, (y − from) / span
 * (at most 1). Pure.
 */
export function stratusAt(y, { from = 250, span = 300, peak = null, max = 0.85, above = 0.45 } = {}) {
  if (y <= from) return 0;
  if (peak == null) return Math.min(1, (y - from) / span);
  const smooth = (t) => t * t * (3 - 2 * t);
  if (y <= peak) return max * smooth(Math.min(1, (y - from) / (peak - from)));
  return max + (above - max) * smooth(Math.min(1, (y - peak) / span));
}

/** A bank's polar grid: RINGS rings out from its middle, SECTORS sectors round. */
export const RINGS = 4, SECTORS = 14;

/**
 * The sheets standing on nodes [k0, k1): [{ k, kind, x, z, y, size, alpha }].
 * @param {{ n, cell, x0, z0 }} grid
 * @param {Float32Array} ground  each node's height (y)
 * @param {Float32Array | null} canopy  each node's canopy (m): mist lies over forest only
 * @param {object} clouds  the look's clouds (CLOUDS by default)
 */
export function sheetsAt(grid, ground, canopy, clouds = CLOUDS, k0 = 0, k1 = grid.n * grid.n) {
  const { n, cell, x0, z0 } = grid;
  const out = [];
  const S = clouds.sheets, M = clouds.mist;
  for (let k = k0; k < k1; k++) {
    const i = k % n, j = (k - i) / n;
    const g = ground[k];
    if (S && i % S.every === 0 && j % S.every === 0) {
      S.levels.forEach((L, q) => {
        if (g < L - S.below || g > L + S.above || hash01(k, 200 + q) >= S.chance) return;
        out.push({ k, kind: "stratus", x: x0 + i * cell, z: z0 + j * cell, y: L + (hash01(k, 210 + q) - 0.5) * 30, size: S.size * (0.75 + 0.5 * hash01(k, 220 + q)), alpha: S.alpha * (0.7 + 0.3 * hash01(k, 230 + q)), clear: S.clear, thick: (S.thick ?? CLOUDS.sheets.thick) * (0.7 + 0.6 * hash01(k, 235 + q)) });
      });
    }
    if (M && canopy && canopy[k] > 5 && i % M.every === 5 % M.every && j % M.every === 5 % M.every && hash01(k, 240) < M.chance && within(M.within, x0 + i * cell, z0 + j * cell)) {
      // a hollow: lower than the ring round it
      let s = 0, c = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const ii = i + di * M.every, jj = j + dj * M.every;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        s += ground[jj * n + ii];
        c++;
      }
      if (c === 8 && s / c - g >= M.hollow) out.push({ k, kind: "mist", x: x0 + i * cell, z: z0 + j * cell, y: g + canopy[k] + M.lift, size: M.size * (0.75 + 0.5 * hash01(k, 250)), alpha: M.alpha, clear: M.clear, thick: M.thick ?? CLOUDS.mist.thick });
    }
  }
  return out;
}

/** The ground's height at (x, z), bilinear over the nodes (the grid's edge held). */
function groundAt(grid, ground, x, z) {
  const { n, cell, x0, z0 } = grid;
  const fi = Math.max(0, Math.min(n - 1.000001, (x - x0) / cell)), fj = Math.max(0, Math.min(n - 1.000001, (z - z0) / cell));
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const a = ground[j * n + i], b = ground[j * n + i + 1], c = ground[(j + 1) * n + i], d = ground[(j + 1) * n + i + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * The caps the place names: [{ x, z, below, size, alpha?, clear?, thick? }]
 * (in the frame) → banks round each summit, `below` metres under the
 * highest node within a cell of it, keyed −1, −2, … (not a node).
 */
export function capsAt(grid, ground, caps = []) {
  const { n, cell, x0, z0 } = grid;
  return caps.map((c, q) => {
    const i = Math.round((c.x - x0) / cell), j = Math.round((c.z - z0) / cell);
    let top = -Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n) top = Math.max(top, ground[jj * n + ii]);
    }
    return { k: -1 - q, kind: "cap", x: c.x, z: c.z, y: top - c.below, size: c.size, alpha: c.alpha ?? 0.6, clear: c.clear ?? 4, thick: c.thick ?? 60 };
  });
}

/** A bank's rim radius in each sector, of its half-size: 0.6 to 1, a hash a sector smoothed with its neighbours'. */
export function rimOf(sh) {
  const raw = Array.from({ length: SECTORS }, (_, q) => hash01(sh.k >>> 0, 270 + q + (sh.kind === "cap" ? 40 : 0)));
  return raw.map((h, q) => 0.6 + 0.4 * (raw[(q + SECTORS - 1) % SECTORS] + 2 * h + raw[(q + 1) % SECTORS]) / 4);
}

/**
 * The banks as one indexed mesh with RGBA colours (linear): each bank a
 * lens of two surfaces (its top domed `thick` over its base, its underside
 * sagging a third of that), each a polar grid (a middle and RINGS rings of
 * SECTORS), its rim ragged (rimOf), its alpha the bank's (shared between
 * the two surfaces) at the middle, falling to 0 at the rim, and 0 where the
 * ground is less than `clear` under it. Triangles with no alpha at any
 * corner are left out.
 * @returns {{ positions: Float32Array, colors: { array: Float32Array, itemSize: 4 }, indices: Uint32Array }}
 */
export function cloudMesh(grid, ground, sheets, { colour = CLOUDS.colour } = {}) {
  const [r, g, b] = hexToLinear(colour);
  const P = [], C = [], I = [];
  // vertex index of ring `ring` (1…RINGS), sector q; 0 the middle
  const vi = (ring, q) => (ring === 0 ? 0 : 1 + (ring - 1) * SECTORS + (q % SECTORS));
  for (const sh of sheets) {
    const rim = rimOf(sh);
    const half = sh.size / 2;
    for (const side of [1, -1 / 3]) {
      const base = P.length / 3;
      const va = [];
      for (let ring = 0; ring <= RINGS; ring++) {
        for (let q = 0; q < (ring === 0 ? 1 : SECTORS); q++) {
          const rho = ring / RINGS, a = (q * 2 * Math.PI) / SECTORS;
          const rr = rho * half * rim[q];
          const x = sh.x + rr * dcos(a), z = sh.z - rr * dsin(a);
          // the lens: domed over (or sagging under) its base, thinning to the rim, a little roll by hash
          const y = sh.y + side * sh.thick * (1 - rho * rho) + 4 * dsin(a * 3 + 6 * hash01(sh.k >>> 0, 263)) * rho;
          const under = y - groundAt(grid, ground, x, z);
          const al = rho >= 1 || under < sh.clear ? 0 : Math.min(1, sh.alpha * 0.6) * (1 - rho * rho) * Math.min(1, (under - sh.clear) / (2 * sh.clear));
          P.push(x, y, z);
          C.push(r, g, b, al);
          va.push(al);
        }
      }
      for (let ring = 0; ring < RINGS; ring++) for (let q = 0; q < SECTORS; q++) {
        const tris = ring === 0 ? [[vi(0, 0), vi(1, q), vi(1, q + 1)]] : [[vi(ring, q), vi(ring + 1, q), vi(ring + 1, q + 1)], [vi(ring, q), vi(ring + 1, q + 1), vi(ring, q + 1)]];
        for (const [u, v, w] of tris) if (va[u] || va[v] || va[w]) I.push(base + u, base + v, base + w);
      }
    }
  }
  return { positions: new Float32Array(P), colors: { array: new Float32Array(C), itemSize: 4 }, indices: Uint32Array.from(I) };
}
