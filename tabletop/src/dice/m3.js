// 3 × 3 rotations and 3-vectors, row-major. Pure. Rotations are kept in docs
// as Euler XYZ, as the scene's transforms are (scene/src/transform.js):
// R = Rx · Ry · Rz.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const len = (v) => Math.hypot(v[0], v[1], v[2]);
export const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const IDENTITY = Object.freeze([Object.freeze([1, 0, 0]), Object.freeze([0, 1, 0]), Object.freeze([0, 0, 1])]);

/** m · v */
export const apply = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
/** a · b */
export const mul = (a, b) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
export const transpose = (m) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[c][r]));

/** Euler XYZ (radians) → a row-major 3 × 3. */
export function eulerMatrix(r) {
  const [x, y, z] = [0, 1, 2].map((i) => Number(r?.[i]) || 0);
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  return [
    [c * e, -c * f, d],
    [a * f + b * d * e, a * e - b * d * f, -b * c],
    [b * f - a * d * e, b * e + a * d * f, a * c],
  ];
}

/** A row-major 3 × 3 rotation → Euler XYZ (radians). */
export function matrixEuler(m) {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}

/** The rotation by `angle` (radians) about the unit vector `axis` (Rodrigues). */
export function axisAngle(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** A unit vector square to the unit vector `u` (the same one every time). */
export function squareTo(u) {
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return unit(sub(ref, scale(u, dot(ref, u))));
}

/** The least rotation that turns the unit vector `a` onto the unit vector `b`. */
export function rotationBetween(a, b) {
  const c = dot(a, b);
  if (c > 1 - 1e-12) return IDENTITY.map((r) => [...r]);
  // opposite: a half turn about anything square to a
  if (c < -1 + 1e-12) return axisAngle(squareTo(a), Math.PI);
  const axis = cross(a, b);
  return axisAngle(unit(axis), Math.atan2(len(axis), c));
}

/**
 * A rotation as one turn about one axis: { axis, angle }, angle in [0, π].
 * For no turn at all the axis is `fallback` (any unit vector will do).
 */
export function toAxisAngle(m, fallback = [0, 1, 0]) {
  const c = Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2));
  const angle = Math.acos(c);
  if (angle < 1e-9) return { axis: [...fallback], angle: 0 };
  if (Math.PI - angle > 1e-6) {
    return { axis: unit([m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1]]), angle };
  }
  // a half turn: m = 2 a aᵀ − 1, so a's biggest part comes from the diagonal and the rest from that row
  const d = [m[0][0], m[1][1], m[2][2]];
  const i = d.indexOf(Math.max(...d));
  const ai = Math.sqrt(Math.max(0, (d[i] + 1) / 2));
  const axis = [0, 1, 2].map((j) => (j === i ? ai : (m[i][j] + m[j][i]) / (4 * ai)));
  return { axis: unit(axis), angle };
}

/** A small, fast seeded generator (mulberry32): () → [0, 1). */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
