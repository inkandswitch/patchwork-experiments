// Standing a piece on edge and laying it flat: what you do with a domino in
// front of you, and with any piece thick enough to stand. Pure, in the frame
// of what the piece lies on (its parent's; the world's at the root), whose
// +Y is up. Matrices are 4 × 4 column-major (frame.js).
//
// A piece's own frame: +Y its face, +Z its length (as a card's and a tile's).
//
//   - standPose: on edge, its face toward `toward` (a level direction), its
//     length level and across it, turned as little from how it lay as can be.
//   - layPose: flat, face up, its length the way it pointed.
//   - restAt: either one set down where the piece was: the middle of its
//     footprint where it was, its underside on what it lay on.
//   - spread: a hand laid out face up in rows (Lay my hand face up).

/** A body box's eight corners. */
const corners = (box) => Array.from({ length: 8 }, (_, i) => [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]]);

/** A body box under a matrix, boxed again: { min, max }. */
export function boxUnder(m, box) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of corners(box)) {
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

const norm = (v) => {
  const l = Math.hypot(...v);
  return l > 1e-12 ? v.map((x) => x / l) : null;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axis = (m, k) => norm([m[4 * k], m[4 * k + 1], m[4 * k + 2]]);
const level = (v) => norm([v[0], 0, v[2]]);
/** A rotation from its three axes (columns), at the origin. */
const frame = (x, y, z) => [...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1];

/** How far its face is turned up: +1 face up, −1 face down, 0 on edge. */
export const upness = (m) => axis(m, 1)?.[1] ?? 0;

/** Is it standing on an edge or an end (its face more level than not)? */
export const isStanding = (m) => Math.abs(upness(m)) < Math.SQRT1_2;

/**
 * Thick enough to stand on its edge: its thinnest side at least a fifth of
 * its middle one (a domino, 9.5 of 25 mm; never a card, 1 of 56).
 */
export function canStand(box) {
  if (!box) return false;
  const s = [0, 1, 2].map((k) => Math.abs(box.max[k] - box.min[k])).sort((a, b) => a - b);
  return s[1] > 0 && s[0] / s[1] >= 0.2;
}

/**
 * A rotation `r` (matrix, origin ignored) set down where `m` is: the middle
 * of its footprint where `m`'s was, its lowest point where `m`'s was. The
 * piece's scale is kept.
 */
export function restAt(m, r, box) {
  const s = Math.hypot(m[0], m[1], m[2]) || 1;
  const turned = r.map((v, i) => (i < 12 && i % 4 !== 3 ? v * s : v));
  turned[12] = turned[13] = turned[14] = 0;
  const was = boxUnder(m, box);
  const now = boxUnder(turned, box);
  turned[12] = (was.min[0] + was.max[0]) / 2 - (now.min[0] + now.max[0]) / 2;
  turned[13] = was.min[1] - now.min[1];
  turned[14] = (was.min[2] + was.max[2]) / 2 - (now.min[2] + now.max[2]) / 2;
  return turned;
}

/**
 * On edge, face toward `toward` (any direction with a level part), length
 * level and across it, keeping the way its length pointed as far as it can.
 * @returns {number[] | null} the matrix, set down where it was; null if `toward` has no level part
 */
export function standPose(m, box, toward) {
  const y = level(toward);
  if (!y) return null;
  // its length: level and square to its face, the one of the two ways nearer where it pointed
  let z = [y[2], 0, -y[0]];
  const was = axis(m, 2) ?? [0, 0, 1];
  if (dot(z, was) < 0) z = z.map((v) => -v);
  return restAt(m, frame(cross(y, z), y, z), box);
}

/** Flat and face up, its length the way it pointed (else the way its face did). @returns the matrix, set down where it was */
export function layPose(m, box) {
  const y = [0, 1, 0];
  const z = level(axis(m, 2) ?? [0, 0, 1]) ?? level(axis(m, 1) ?? [0, 0, 1]) ?? [0, 0, 1];
  return restAt(m, frame(cross(y, z), y, z), box);
}

/**
 * Where a hand's pieces lie when it is laid out face up: rows across a
 * place's front edge, in that place's frame (its +Z toward its player; its
 * front edge is `edge`, the z its pieces go out past, toward the table),
 * each piece flat, its length pointing out from the player, side by side.
 * Rows of as many as fit in `width` (centred on x = 0), the first row
 * nearest the edge.
 * @param {{ min: number[], max: number[] }[]} boxes  each piece's body box, in hand order
 * @param {{ edge: number, width: number, gap?: number }} o
 * @returns {{ x: number, z: number }[]} where each piece's footprint is centred (place frame)
 */
export function spread(boxes, { edge, width, gap = 0.005 }) {
  if (!boxes.length) return [];
  const across = Math.max(...boxes.map((b) => b.max[0] - b.min[0])) + gap;
  const along = Math.max(...boxes.map((b) => b.max[2] - b.min[2])) + gap;
  const per = Math.max(1, Math.floor((width + gap) / across));
  return boxes.map((_, i) => {
    const row = Math.floor(i / per);
    const inRow = Math.min(per, boxes.length - row * per);
    const col = i % per;
    return { x: +((col - (inRow - 1) / 2) * across).toFixed(5), z: +(edge - 2 * gap - along / 2 - row * along).toFixed(5) };
  });
}
