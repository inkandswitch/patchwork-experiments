// Orbit camera maths for the preview. Pure: no DOM, no WebGL.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/** A camera that frames a bounds box from a pleasant three-quarter view. */
export function frameBounds(bounds, fovY = 0.7) {
  const c = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2);
  const diag = Math.hypot(...[0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]));
  const dist = (diag / 2 / Math.tan(fovY / 2)) * 0.95;
  return { target: c, yaw: 0.65, pitch: 0.42, dist, fovY };
}

/** Eye position and an orthonormal basis (right, up, forward) for an orbit camera. */
export function cameraBasis(cam) {
  const cp = Math.cos(cam.pitch);
  const fwd = [-Math.sin(cam.yaw) * cp, -Math.sin(cam.pitch), -Math.cos(cam.yaw) * cp];
  const eye = [0, 1, 2].map((i) => cam.target[i] - fwd[i] * cam.dist);
  // right = normalize(fwd × up_world), up = right × fwd
  let right = [-fwd[2], 0, fwd[0]];
  const rl = Math.hypot(right[0], right[2]) || 1;
  right = [right[0] / rl, 0, right[2] / rl];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { eye, right, up, fwd };
}

export function orbit(cam, dx, dy) {
  return { ...cam, yaw: cam.yaw - dx * 0.008, pitch: clamp(cam.pitch + dy * 0.008, -PITCH_LIMIT, PITCH_LIMIT) };
}

/** Pan by a pixel delta, given the viewport height in pixels. */
export function pan(cam, dx, dy, viewportHeight) {
  const { right, up } = cameraBasis(cam);
  const worldPerPixel = (2 * cam.dist * Math.tan(cam.fovY / 2)) / Math.max(1, viewportHeight);
  const target = [0, 1, 2].map((i) => cam.target[i] - right[i] * dx * worldPerPixel + up[i] * dy * worldPerPixel);
  return { ...cam, target };
}

export function zoom(cam, factor, minDist = 1e-4, maxDist = 1e5) {
  return { ...cam, dist: clamp(cam.dist * factor, minDist, maxDist) };
}
