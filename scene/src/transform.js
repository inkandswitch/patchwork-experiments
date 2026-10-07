// Scene-object transforms as plain arrays, so they can be tested without three.
// Matrices are 4×4 column-major (three.js / glTF order).
//
// A transform is { position: [x,y,z], rotation: [x,y,z] (Euler XYZ, radians),
// scale: number } — uniform scale only, so any chain of them (a parent's world
// matrix times a child's local one) is again a rotation, a uniform scale and a
// translation, and decomposes back into a transform exactly.

export const IDENTITY_TRANSFORM = Object.freeze({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
});

export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const vec3 = (v, d = 0) => [num(v?.[0], d), num(v?.[1], d), num(v?.[2], d)];

/** Fill in a possibly partial/garbled transform. */
export function normalizeTransform(t) {
  const s = num(t?.scale, 1);
  return {
    position: vec3(t?.position),
    rotation: vec3(t?.rotation),
    scale: s === 0 ? 1 : s,
  };
}

/** T · R(XYZ) · S as a column-major 4×4. Matches three's Matrix4.compose with Euler "XYZ". */
export function composeMatrix(transform) {
  const { position: p, rotation: r, scale: s } = normalizeTransform(transform);
  const a = Math.cos(r[0]), b = Math.sin(r[0]);
  const c = Math.cos(r[1]), d = Math.sin(r[1]);
  const e = Math.cos(r[2]), f = Math.sin(r[2]);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // rotation matrix for Euler XYZ (row-major m[row][col])
  const m11 = c * e, m12 = -c * f, m13 = d;
  const m21 = af + be * d, m22 = ae - bf * d, m23 = -b * c;
  const m31 = bf - ae * d, m32 = be + af * d, m33 = a * c;
  return [
    m11 * s, m21 * s, m31 * s, 0,
    m12 * s, m22 * s, m32 * s, 0,
    m13 * s, m23 * s, m33 * s, 0,
    p[0], p[1], p[2], 1,
  ];
}

export function applyMatrix(m, v) {
  const [x, y, z] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** a · b (apply b first, then a). */
export function multiplyMatrices(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

/** General 4×4 inverse; null if singular. */
export function invertMatrix(m) {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (!det || !Number.isFinite(det)) return null;
  const i = 1 / det;
  return [
    t11 * i,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * i,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * i,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * i,
    t12 * i,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * i,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * i,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * i,
    t13 * i,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * i,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * i,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * i,
    t14 * i,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * i,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * i,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * i,
  ];
}

// Round away float noise (1e-17 → 0) so re-parenting doesn't write junk digits.
const tidy = (v) => {
  const r = Math.round(v * 1e12) / 1e12;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * The transform whose composeMatrix is `m`: position, Euler XYZ rotation and a
 * uniform scale (the mean of the three axis lengths). Exact for any product of
 * transforms; matches three's Matrix4.decompose + Euler.setFromRotationMatrix.
 */
export function decomposeMatrix(m) {
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
  return {
    position: [tidy(m[12]), tidy(m[13]), tidy(m[14])],
    rotation: [tidy(x), tidy(y), tidy(z)],
    scale: tidy(s),
  };
}
