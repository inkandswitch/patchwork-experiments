// The hull frame: x forward, y port, z up, metres (Chartroom's, and the rig
// aid's). A GLB is glTF (Y up by the spec, but a hull can be modelled any way
// round), so the designer says which GLB axis the bow points along and which
// is up, and the rest follows: port = up × bow, which keeps the frame
// right-handed. The choice is stored in the doc (hull.link.frame) and used
// only when the source states no Chartroom referenceState. extras.ship is
// never read.
//
// camber's renders (bow +X, up +Y, design waterline at Y = 0 by default) are
// the default choice, so a camber hull needs no choosing.

export const BOW_AXES = ["+X", "-X", "+Z", "-Z"];
export const UP_AXES = ["+Y", "+Z"];
export const DEFAULT_FRAME = Object.freeze({ bow: "+X", up: "+Y" });

const AXIS = {
  "+X": [1, 0, 0],
  "-X": [-1, 0, 0],
  "+Y": [0, 1, 0],
  "-Y": [0, -1, 0],
  "+Z": [0, 0, 1],
  "-Z": [0, 0, -1],
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A frame made safe: known axes, bow not along up (else the default). */
export function normalizeFrame(f) {
  const bow = BOW_AXES.includes(f?.bow) ? f.bow : DEFAULT_FRAME.bow;
  const up = UP_AXES.includes(f?.up) ? f.up : DEFAULT_FRAME.up;
  if (dot(AXIS[bow], AXIS[up]) !== 0) return { ...DEFAULT_FRAME };
  return { bow, up };
}

/**
 * The rows of the GLB → hull-frame rotation: hull = [bow·p, port·p, up·p].
 * @returns {number[][]} 3 × 3, rows x, y, z
 */
export function frameMatrix(frame) {
  const { bow, up } = normalizeFrame(frame);
  const b = AXIS[bow];
  const u = AXIS[up];
  return [b, cross(u, b), u];
}

/** Map a flat xyz array (glTF, metres) into the hull frame, offset by `shift` (subtracted after rotating). */
export function toHullFrame(triangles, frame, shift = [0, 0, 0]) {
  const [rx, ry, rz] = frameMatrix(frame);
  const out = new Float64Array(triangles.length);
  for (let i = 0; i < triangles.length; i += 3) {
    const p = [triangles[i], triangles[i + 1], triangles[i + 2]];
    out[i] = dot(rx, p) - shift[0];
    out[i + 1] = dot(ry, p) - shift[1];
    out[i + 2] = dot(rz, p) - shift[2];
  }
  return out;
}

/** Column-major 4 × 4 glTF → hull frame (rotation, then −shift): what the contract calls glbToFrame. */
export function glbToFrameMatrix(frame, shift = [0, 0, 0]) {
  const [rx, ry, rz] = frameMatrix(frame);
  return [rx[0], ry[0], rz[0], 0, rx[1], ry[1], rz[1], 0, rx[2], ry[2], rz[2], 0, -shift[0], -shift[1], -shift[2], 1];
}

/** A short human label: "bow +X, up +Y". */
export const frameLabel = (f) => {
  const n = normalizeFrame(f);
  return `bow ${n.bow}, up ${n.up}`;
};
