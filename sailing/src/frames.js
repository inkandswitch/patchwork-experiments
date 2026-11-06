// Frames: points and directions between the world and an object's frame,
// and rotations between the forms the stage, the doc and the physics use.
// Pure. Matrices are 4×4, column-major, as worldOf gives them (a uniform
// scale at most); quaternions are [x, y, z, w]; Euler angles are XYZ, in
// radians, as the doc stores them (and the stage's smooth.js converts them).

// ─── matrices ───────────────────────────────────────────────────────────────

/** A point through a matrix. */
export function apply(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** The inverse of an affine matrix. */
export function invert(m) {
  const r = (row, col) => m[col * 4 + row];
  const c00 = r(1, 1) * r(2, 2) - r(1, 2) * r(2, 1);
  const c01 = r(1, 2) * r(2, 0) - r(1, 0) * r(2, 2);
  const c02 = r(1, 0) * r(2, 1) - r(1, 1) * r(2, 0);
  const k = 1 / (r(0, 0) * c00 + r(0, 1) * c01 + r(0, 2) * c02);
  const inv = [
    [c00 * k, (r(0, 2) * r(2, 1) - r(0, 1) * r(2, 2)) * k, (r(0, 1) * r(1, 2) - r(0, 2) * r(1, 1)) * k],
    [c01 * k, (r(0, 0) * r(2, 2) - r(0, 2) * r(2, 0)) * k, (r(0, 2) * r(1, 0) - r(0, 0) * r(1, 2)) * k],
    [c02 * k, (r(0, 1) * r(2, 0) - r(0, 0) * r(2, 1)) * k, (r(0, 0) * r(1, 1) - r(0, 1) * r(1, 0)) * k],
  ];
  const t = [m[12], m[13], m[14]];
  const out = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[col * 4 + row] = inv[row][col];
    out[12 + row] = -(inv[row][0] * t[0] + inv[row][1] * t[1] + inv[row][2] * t[2]);
  }
  out[15] = 1;
  return out;
}

const axis = (m, i) => {
  const v = [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A direction from a matrix's frame to the world (its rotation only; scale ignored). */
export function rotateM(m, [x, y, z]) {
  const [a, b, c] = [axis(m, 0), axis(m, 1), axis(m, 2)];
  return [a[0] * x + b[0] * y + c[0] * z, a[1] * x + b[1] * y + c[1] * z, a[2] * x + b[2] * y + c[2] * z];
}

/** A direction from the world into a matrix's frame (its rotation only). */
export function unrotateM(m, v) {
  const dot = (a) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  return [dot(axis(m, 0)), dot(axis(m, 1)), dot(axis(m, 2))];
}

/** A matrix's uniform scale. */
export const scaleOf = (m) => Math.hypot(m[0], m[1], m[2]) || 1;

/** Which way a frame's −Z points, as a yaw about +Y (0 looks down −Z, as the walker's yaw). */
export const headingOf = (m) => Math.atan2(m[8], m[10]);

/** A point offset in a frame turned only by its heading (a camera that doesn't roll with the ship). */
export function onHeading(m, [x, y, z]) {
  const h = headingOf(m);
  const c = Math.cos(h);
  const s = Math.sin(h);
  return [m[12] + x * c + z * s, m[13] + y, m[14] - x * s + z * c];
}

// ─── quaternions and Euler angles ───────────────────────────────────────────

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Euler XYZ → a unit quaternion. */
export function quatFromEuler(r) {
  const c1 = Math.cos(r[0] / 2), s1 = Math.sin(r[0] / 2);
  const c2 = Math.cos(r[1] / 2), s2 = Math.sin(r[1] / 2);
  const c3 = Math.cos(r[2] / 2), s3 = Math.sin(r[2] / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/** A unit quaternion → Euler XYZ. */
export function eulerFromQuat(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ry, 0];
}

/** v turned by the unit quaternion q. */
export function rotateQ(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The inverse of a unit quaternion. */
export const conjQ = (q) => [-q[0], -q[1], -q[2], q[3]];

/** A matrix as { position, quaternion, scale }. */
export function poseOfMatrix(m) {
  const s = scaleOf(m);
  const a = m[0] / s, b = m[4] / s, c = m[8] / s;
  const d = m[1] / s, e = m[5] / s, f = m[9] / s;
  const g = m[2] / s, h = m[6] / s, i = m[10] / s;
  const tr = a + e + i;
  let q;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1);
    q = [(h - f) * k, (c - g) * k, (d - b) * k, 0.25 / k];
  } else if (a > e && a > i) {
    const k = 2 * Math.sqrt(1 + a - e - i);
    q = [0.25 * k, (b + d) / k, (c + g) / k, (h - f) / k];
  } else if (e > i) {
    const k = 2 * Math.sqrt(1 + e - a - i);
    q = [(b + d) / k, 0.25 * k, (f + h) / k, (c - g) / k];
  } else {
    const k = 2 * Math.sqrt(1 + i - a - e);
    q = [(c + g) / k, (f + h) / k, 0.25 * k, (d - b) / k];
  }
  const n = Math.hypot(...q) || 1;
  return { position: [m[12], m[13], m[14]], quaternion: q.map((v) => v / n), scale: s };
}
