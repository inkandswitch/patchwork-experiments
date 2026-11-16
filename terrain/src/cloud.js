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
//   soft sheet `size` metres across lies at the level, ± a few metres by
//   hash. A sheet is a small grid of vertices whose alpha falls to nothing
//   at its edge and wherever the ground there is less than `clear` under
//   it (so a sheet never shows as a hard line cut into the hillside, it
//   thins into it);
// - mist: the same walk over the forest's hollows (a node lower than the
//   mean of the ring `every` nodes round it by at least `hollow`), a thin
//   sheet `lift` metres over the canopy.
//
// Every sheet is a function of its node and the heights round it, and
// nothing else (tested: tile by tile is the whole). One indexed mesh with
// RGBA colours, each sheet three layers deep, drawn unlit and blended.
//
// Pure.

import { hash01 } from "./palette.js";
import { hexToLinear } from "./glb.js";
import { dsin, dcos, len } from "./detmath.js";

export const CLOUDS = Object.freeze({
  colour: "#d3d9d9",
  sheets: { levels: [320, 460], every: 8, below: 90, above: 30, chance: 0.35, size: 520, alpha: 0.55, clear: 12 },
  mist: { every: 10, hollow: 25, chance: 0.3, size: 360, lift: 12, alpha: 0.32, clear: 6 },
});

const R = 3; // a sheet's grid: (2R + 1)² vertices

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
        out.push({ k, kind: "stratus", x: x0 + i * cell, z: z0 + j * cell, y: L + (hash01(k, 210 + q) - 0.5) * 30, size: S.size * (0.75 + 0.5 * hash01(k, 220 + q)), alpha: S.alpha * (0.7 + 0.3 * hash01(k, 230 + q)), clear: S.clear });
      });
    }
    if (M && canopy && canopy[k] > 5 && i % M.every === 5 % M.every && j % M.every === 5 % M.every && hash01(k, 240) < M.chance) {
      // a hollow: lower than the ring round it
      let s = 0, c = 0;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const ii = i + di * M.every, jj = j + dj * M.every;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        s += ground[jj * n + ii];
        c++;
      }
      if (c === 8 && s / c - g >= M.hollow) out.push({ k, kind: "mist", x: x0 + i * cell, z: z0 + j * cell, y: g + canopy[k] + M.lift, size: M.size * (0.75 + 0.5 * hash01(k, 250)), alpha: M.alpha, clear: M.clear });
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
 * The sheets as one indexed mesh with RGBA colours (linear): each sheet a
 * (2R + 1)² grid, `layers` deep (`gap` metres apart, so from the side it
 * has a body, not an edge), its alpha the sheet's shared among its layers
 * at the middle, falling to 0 at its rim, and 0 where the ground is less
 * than `clear` under it. Triangles with no alpha at any corner are left out.
 * @returns {{ positions: Float32Array, colors: { array: Float32Array, itemSize: 4 }, indices: Uint32Array }}
 */
export function cloudMesh(grid, ground, sheets, { colour = CLOUDS.colour, layers = 3, gap = 12 } = {}) {
  const [r, g, b] = hexToLinear(colour);
  const P = [], C = [], I = [];
  const W = 2 * R + 1;
  for (const sh of sheets) {
    const step = sh.size / (2 * R);
    for (let layer = 0; layer < layers; layer++) {
      const base = P.length / 3;
      const lift = layer * gap, share = layers > 1 ? 1.6 / layers : 1;
      const va = [];
      for (let q = -R; q <= R; q++) for (let p = -R; p <= R; p++) {
        const x = sh.x + p * step, z = sh.z + q * step;
        // a little roll in the sheet, by its own hash, each layer its own
        const y = sh.y + lift + 6 * dsin((p + 3 * hash01(sh.k, 260 + layer)) * 0.9) * dcos((q + 3 * hash01(sh.k, 263 + layer)) * 0.7);
        const rr = len(p, q) / R;
        const under = y - groundAt(grid, ground, x, z);
        const a = rr >= 1 || under < sh.clear ? 0 : Math.min(1, sh.alpha * share) * (1 - rr * rr) * Math.min(1, (under - sh.clear) / (2 * sh.clear));
        P.push(x, y, z);
        C.push(r, g, b, a);
        va.push(a);
      }
      for (let q = 0; q < 2 * R; q++) for (let p = 0; p < 2 * R; p++) {
        const A = q * W + p, B = A + 1, Cc = A + W, D = Cc + 1;
        for (const [u, v, w] of [[A, Cc, B], [B, Cc, D]]) if (va[u] || va[v] || va[w]) I.push(base + u, base + v, base + w);
      }
    }
  }
  return { positions: new Float32Array(P), colors: { array: new Float32Array(C), itemSize: 4 }, indices: Uint32Array.from(I) };
}
