// 4 × 4 matrices for a table that sits on something: a scene transform's
// matrix and back, products, inverses, points. Column-major, Euler XYZ, a
// uniform scale, as the scene's own (scene/src/transform.js), copied rather
// than imported: packages stand alone.

const tidy = (v) => Math.round(v * 1e9) / 1e9 + 0;

/** T · R(XYZ) · S, column-major. */
export function composeMatrix(t) {
  const p = t?.position ?? [0, 0, 0];
  const r = t?.rotation ?? [0, 0, 0];
  const s = Number(t?.scale) || 1;
  const a = Math.cos(r[0]), b = Math.sin(r[0]);
  const c = Math.cos(r[1]), d = Math.sin(r[1]);
  const e = Math.cos(r[2]), f = Math.sin(r[2]);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m11 = c * e, m12 = -c * f, m13 = d;
  const m21 = af + be * d, m22 = ae - bf * d, m23 = -b * c;
  const m31 = bf - ae * d, m32 = be + af * d, m33 = a * c;
  return [m11 * s, m21 * s, m31 * s, 0, m12 * s, m22 * s, m32 * s, 0, m13 * s, m23 * s, m33 * s, 0, Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0, 1];
}

/** a · b. */
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The inverse of a rotation · uniform scale + translation (what a scene transform makes). */
export function invert(m) {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] || 1;
  const out = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1].map((v, i) => (i % 4 === 3 || i >= 12 ? v : v / s2));
  for (let r = 0; r < 3; r++) out[12 + r] = -(out[r] * m[12] + out[4 + r] * m[13] + out[8 + r] * m[14]);
  return out;
}

/** A point through a matrix. */
export const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/** The transform whose matrix is `m` (scene/src/transform.js decomposeMatrix). */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const s = (sx + sy + sz) / 3 || 1;
  const m11 = m[0] / sx, m12 = m[4] / sy, m13 = m[8] / sz;
  const m22 = m[5] / sy, m23 = m[9] / sz;
  const m32 = m[6] / sy, m33 = m[10] / sz;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x, z;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return { position: [tidy(m[12]), tidy(m[13]), tidy(m[14])], rotation: [tidy(x), tidy(y), tidy(z)], scale: tidy(s) };
}

/**
 * A pose given as a matrix in some frame, as a doc transform, kept tidy: one
 * lying level in that frame (its +Y the frame's +Y) is written as a turn
 * about Y alone ([0, yaw, 0]), whichever way it faces, so it reads as a yaw
 * and turns the short way; anything else as decompose has it.
 */
export function levelPose(m) {
  const s = Math.hypot(m[4], m[5], m[6]) || 1;
  if (m[5] / s > 1 - 1e-9) {
    return { position: [tidy(m[12]), tidy(m[13]), tidy(m[14])], rotation: [0, tidy(Math.atan2(m[8], m[10])), 0], scale: tidy(s) };
  }
  return decompose(m);
}

/** A transform under another: where `t` (in a frame placed at `outer` in its parent) is in that parent. */
export const compose = (outer, t) => decompose(multiply(composeMatrix(outer), composeMatrix(t)));
