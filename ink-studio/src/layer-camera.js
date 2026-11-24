// The camera ink draws an object's world with, from the camera the stage is
// drawing with. Pure; column-major 4×4 matrices as plain arrays (three's
// `elements`).
//
// The ink world sits in the object's local frame. With the object's world
// matrix M = T·R·S (S uniform, s) and the stage's view V, a local point p is
// at V·M·p in the stage's view space. Ink takes only a rigid view, so it gets
//   view  = V·T·R with its translation divided by s,
// which puts p at (V·M·p)/s: ink's view space is the stage's, scaled by 1/s.
// Directions, and so the projection's x and y, are unchanged; ink's near and
// far are the stage's over s; a depth ink reports times s is the stage's.

/** a·b, column-major 4×4. */
export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  return o;
}

/** M's uniform scale and its rigid part (columns normalised). */
export function rigidOf(m) {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const s = (sx + sy + sz) / 3;
  const r = m.slice();
  for (let i = 0; i < 3; i++) {
    r[i] /= sx;
    r[4 + i] /= sy;
    r[8 + i] /= sz;
  }
  return { s, rigid: r };
}

/** The same perspective with other near and far planes. */
export function withPlanes(p, near, far) {
  const q = p.slice();
  q[10] = -(far + near) / (far - near);
  q[14] = (-2 * far * near) / (far - near);
  return q;
}

/** near and far from a perspective projection. */
export const planesOf = (p) => ({ near: p[14] / (p[10] - 1), far: p[14] / (p[10] + 1) });

/**
 * @param {{ view: number[], projection: number[], object: number[],
 *   bounds: { centre: number[], radius: number } }} o
 *   view: the stage camera's matrixWorldInverse; projection: its
 *   projectionMatrix (perspective); object: the object's matrixWorld;
 *   bounds: the ink world's, in its own units.
 * @returns {null | { viewMatrix, projectionMatrix, depthRange: [number, number], scale: number }}
 *   null when the world is wholly behind the near plane.
 */
export function inkCamera({ view, projection, object, bounds }) {
  const { s, rigid } = rigidOf(object);
  if (!(s > 1e-9)) return null;
  const viewMatrix = mul(view, rigid);
  for (const i of [12, 13, 14]) viewMatrix[i] /= s;
  const { near, far } = planesOf(projection);
  const n = near / s, f = far / s;
  const [cx, cy, cz] = bounds.centre;
  const dist = -(viewMatrix[2] * cx + viewMatrix[6] * cy + viewMatrix[10] * cz + viewMatrix[14]);
  const margin = bounds.radius * 1.05;
  const r1 = Math.min(f, dist + margin);
  if (r1 <= n) return null;
  const r0 = Math.max(n, dist - margin);
  return { viewMatrix, projectionMatrix: withPlanes(projection, n, f), depthRange: [r0, Math.max(r1, r0 + 1e-4)], scale: s };
}
