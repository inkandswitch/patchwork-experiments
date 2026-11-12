// Washing: mixing pieces that lie face down, spread out on the table (a
// boneyard of dominoes), by sweeping them about under your hands. Two pure
// parts, used by the table's Wash (extension.js) and by setting a table up
// (setup.js, a deck that starts `spread`):
//
//   - cluster: which pieces are swept together: those whose footprints come
//     within `link` of one another, one to the next (a connected component).
//   - jumble: where they lie afterwards: a grid of cells round a centre,
//     each piece at a random turn, so far apart that no two can touch
//     whichever way each is turned (each cell holds the piece's whole
//     reach, a circle).
//
// What a washed piece really is, is its keeper's to shuffle: positions say
// nothing (they are public), and this module never sees what anything is.

/** How far apart two footprints are in plan (0 if they touch or overlap): boxes' { min, max }, x and z. */
export function gap(a, b) {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dz);
}

/**
 * The pieces swept together with `start`: every piece joined to it by a
 * chain of pieces each within `link` of the next. In the order found.
 * @param {{ [id: string]: { min: number[], max: number[] } }} boxes  world (or one frame's) boxes of the candidates
 * @param {string} start
 * @param {number} link  metres
 * @returns {string[]} [] when `start` isn't among them
 */
export function cluster(boxes, start, link) {
  if (!Object.hasOwn(boxes, start)) return [];
  const ids = Object.keys(boxes);
  const seen = new Set([start]);
  const out = [start];
  for (let i = 0; i < out.length; i++) {
    const a = boxes[out[i]];
    for (const id of ids) {
      if (seen.has(id) || !(gap(a, boxes[id]) <= link)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** How many columns a jumble of n has: a little wider than deep (7 × 4 for a double-six set). */
export const colsFor = (n) => Math.max(1, Math.ceil(Math.sqrt(Math.max(0, n) * 1.75)));

/**
 * Where n pieces lie after a wash: rows of `cols` cells `cell` apart,
 * centred on `centre` ([x, z]), each piece somewhere in its cell and turned
 * any way. A piece reaches `reach` from its middle (half its plan
 * diagonal); in a cell of at least twice that, two pieces never touch.
 * @param {number} n
 * @param {{ centre?: number[], cols?: number, cell: number, reach?: number, rng?: () => number }} o
 * @returns {{ x: number, z: number, yaw: number }[]} n spots, in cell order (positions to 10 µm, turns to 0.1 mrad)
 */
export function jumble(n, { centre = [0, 0], cols = colsFor(n), cell, reach = 0, rng = Math.random } = {}) {
  const count = Math.max(0, Math.floor(n));
  const c = Math.max(1, Math.round(cols));
  const size = Math.max(Number(cell) || 0, 2 * reach + 2e-5);
  const rows = Math.ceil(count / c);
  // how far a piece may wander from its cell's middle, each way (less the 10 µm the rounding may move it)
  const slack = Math.max(0, size / 2 - reach - 1e-5);
  const r = (v, k) => +v.toFixed(k);
  const out = [];
  for (let i = 0; i < count; i++) {
    const col = i % c;
    const row = Math.floor(i / c);
    // a last row that isn't full is centred too
    const inRow = row === rows - 1 ? count - row * c : c;
    const x = centre[0] + (col - (inRow - 1) / 2) * size + (2 * unit(rng) - 1) * slack;
    const z = centre[1] + (row - (rows - 1) / 2) * size + (2 * unit(rng) - 1) * slack;
    out.push({ x: r(x, 5), z: r(z, 5), yaw: Math.floor(unit(rng) * 2 * Math.PI * 1e4) / 1e4 });
  }
  return out;
}

/** An rng's answer, kept in [0, 1). */
const unit = (rng) => {
  const v = Number(rng());
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1 - 1e-12) : 0;
};
