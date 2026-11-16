// The connector table (carry-rules placeConnector, gltf-content findSnapPoints):
// every connector form × every kind of node it can sit on, each with its
// answer worked out by hand — where the connector's frame sends the body's
// X, Y and Z in the node's parent (the root), and the yaw — not by the code
// under test. A node is a rotation written as what it does to a vector (a
// permutation with signs, exact, or a small yaw written out), a scale (a
// negative one mirrors) and a translation.

const Q = Math.SQRT1_2;

/** A turn by θ about +Y, written out: what a node yawed θ does to a vector. */
const yawTurn = (t) => ([a, b, c]) => [Math.cos(t) * a + Math.sin(t) * c, b, -Math.sin(t) * a + Math.cos(t) * c];
const yawQuaternion = (t) => [0, Math.sin(t / 2), 0, Math.cos(t / 2)];

/** The node kinds: how it turns a vector, its glTF quaternion [x, y, z, w], its scale along its own X, Y, Z. */
export const NODES = {
  identity: { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [1, 1, 1] },
  "yawed 90°": { turn: ([a, b, c]) => [c, b, -a], quaternion: [0, Q, 0, Q], scale: [1, 1, 1] }, // +X → −Z, +Z → +X
  "tilted 90° about X": { turn: ([a, b, c]) => [a, -c, b], quaternion: [Q, 0, 0, Q], scale: [1, 1, 1] }, // +Y → +Z, +Z → −Y
  "scaled 2": { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [2, 2, 2] },
  // a CAD export's stretch: the frame is the node's rotation's alone, never sheared by the scale
  "stretched (2, 1, 3)": { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [2, 1, 3] },
  // next to gimbal lock for a standing frame (a rack turned a hair, or a hair short of round): nothing of the turn is lost
  "yawed 1e-4": { turn: yawTurn(1e-4), quaternion: yawQuaternion(1e-4), scale: [1, 1, 1] },
  "yawed π − 1e-4": { turn: yawTurn(Math.PI - 1e-4), quaternion: yawQuaternion(Math.PI - 1e-4), scale: [1, 1, 1] },
  // a mirrored part (a CAD export's left hand made from the right): where a connector faces is mirrored, it is never turned inside out
  "mirrored in X": { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [-1, 1, 1] },
};

const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];
const neg = (v) => v.map((x) => -x);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Euler XYZ (R = Rx·Ry·Rz) written out as its body axes' images [X, Y, Z], for the forms not on a quarter turn. */
function eulerAxes([x, y, z]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz],
    [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz],
    [sy, -sx * cy, cx * cy],
  ];
}
const P = [0.1, 0.2, 0.3];
const framed = (rotation, frame = eulerAxes(rotation)) => ({ raw: { position: P, rotation }, frame });

/**
 * The connector forms: as written in a GLB, and the frame they say (the body
 * axes' images [X, Y, Z]), or null for a connector that gives no whole frame
 * (then `yaw`, the yaw it gives, or null for none).
 */
export const FORMS = {
  "[x, y, z]": { raw: [...P], frame: null, yaw: null },
  "{ position }": { raw: { position: P }, frame: null, yaw: null },
  "{ position, yaw }": { raw: { position: P, yaw: Math.PI / 2 }, frame: null, yaw: Math.PI / 2 },
  // facing +Z: on the node tilted about X it faces straight down, so no yaw (the old sum gave atan2(0, 0))
  "{ position, yaw 0 }": { raw: { position: P, yaw: 0 }, frame: null, yaw: 0 },
  "{ position, yaw π/4 }": { raw: { position: P, yaw: Math.PI / 4 }, frame: null, yaw: Math.PI / 4 },
  // an eighth turn about Y: lying flat, facing between +X and +Z
  "{ position, rotation } flat with a yaw": framed([0, Math.PI / 4, 0], [[Q, 0, -Q], Y, [Q, 0, Q]]),
  // a domino rack's place: a quarter turn about Y, then about X — its X up, its Y toward +Z, its length (Z) along +X
  "{ position, rotation } standing on edge": framed([Math.PI / 2, Math.PI / 2, 0], [Y, Z, X]),
  // −90° about X: +Z straight up, so no yaw
  "{ position, rotation } +Z straight up": framed([-Math.PI / 2, 0, 0], [X, neg(Z), Y]),
  // a hair short of gimbal lock, every angle its own
  "{ position, rotation } pitched π/2 − 1e-5": framed([0.3, Math.PI / 2 - 1e-5, 0.2]),
  // +Z 5e-7 off straight up, inside VERTICAL (1e-6): no yaw; 2e-6 off, outside it: a yaw
  "{ position, rotation } +Z 5e-7 off straight up": framed([-Math.PI / 2 + 5e-7, 0, 0]),
  "{ position, rotation } +Z 2e-6 off straight up": framed([-Math.PI / 2 + 2e-6, 0, 0]),
};

/** Where the node sits (its translation), so the position's answer shows the whole matrix. */
export const AT = [1, 2, 3];

/** The yaw a direction faces, seen from above; null within the stage's VERTICAL (1e-6, carry-rules.js) of straight up or down. */
export const yawOf = ([x, , z]) => (Math.hypot(x, z) < 1e-6 ? null : Math.atan2(x, z));

/** Every (form, node) pair with its answer: { position, frame: [X, Y, Z] images | null, yaw }. */
export function connectorCases() {
  const out = [];
  for (const [form, f] of Object.entries(FORMS)) {
    for (const [node, n] of Object.entries(NODES)) {
      const p = Array.isArray(f.raw) ? f.raw : f.raw.position;
      const position = n.turn(p.map((v, k) => v * n.scale[k])).map((v, k) => v + AT[k]);
      // where the node sends a direction, its scale's sizes left out and its mirror kept
      const dir = (v) => n.turn(v.map((c, k) => c * Math.sign(n.scale[k])));
      // a whole frame: its up and facing carried, X their cross product (on an unmirrored node, dir(X) itself)
      const frame = f.frame ? ((up, facing) => [cross(up, facing), up, facing])(dir(f.frame[1]), dir(f.frame[2])) : null;
      // a whole frame: the yaw its Z faces; yaw only: the yaw the node turns that facing to
      const yaw = frame ? yawOf(frame[2]) : f.yaw == null ? null : yawOf(dir([Math.sin(f.yaw), 0, Math.cos(f.yaw)]));
      out.push({ form, node, raw: f.raw, n, expected: { position, frame, yaw } });
    }
  }
  return out;
}

/** The node's matrix (column-major 4×4), as the turn, scale and translation say. */
export function nodeMatrix(n) {
  const [x, y, z] = [X, Y, Z].map((v, k) => n.turn(v).map((c) => c * n.scale[k]));
  return [...x, 0, ...y, 0, ...z, 0, ...AT, 1];
}

/** A rotation's body axes' images [X, Y, Z] (the columns of its matrix). */
export const axesOf = (m) => [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];

/** Are two yaws (either may be null) the same, the short way round, within tol? */
export const sameYaw = (a, b, tol = 1e-9) => (a == null || b == null ? a === b : Math.abs((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < tol);
