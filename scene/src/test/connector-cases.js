// The connector table (carry-rules placeConnector, gltf-content findSnapPoints):
// every connector form × every kind of node it can sit on, each with its
// answer worked out by hand — where the connector's frame sends the body's
// X, Y and Z in the node's parent (the root), and the yaw — not by the code
// under test. A node is a rotation written as what it does to a vector (a
// permutation with signs, exact), a scale and a translation.

const Q = Math.SQRT1_2;

/** The node kinds: how it turns a vector, its glTF quaternion [x, y, z, w], its scale along its own X, Y, Z. */
export const NODES = {
  identity: { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [1, 1, 1] },
  "yawed 90°": { turn: ([a, b, c]) => [c, b, -a], quaternion: [0, Q, 0, Q], scale: [1, 1, 1] }, // +X → −Z, +Z → +X
  "tilted 90° about X": { turn: ([a, b, c]) => [a, -c, b], quaternion: [Q, 0, 0, Q], scale: [1, 1, 1] }, // +Y → +Z, +Z → −Y
  "scaled 2": { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [2, 2, 2] },
  // a CAD export's stretch: the frame is the node's rotation's alone, never sheared by the scale
  "stretched (2, 1, 3)": { turn: ([a, b, c]) => [a, b, c], quaternion: null, scale: [2, 1, 3] },
};

const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];
const neg = (v) => v.map((x) => -x);

/**
 * The connector forms: as written in a GLB, and the frame they say (the body
 * axes' images [X, Y, Z]), or null for a connector that gives no whole frame
 * (then `yaw`, the yaw it gives, or null for none).
 */
export const FORMS = {
  "[x, y, z]": { raw: [0.1, 0.2, 0.3], frame: null, yaw: null },
  "{ position }": { raw: { position: [0.1, 0.2, 0.3] }, frame: null, yaw: null },
  "{ position, yaw }": { raw: { position: [0.1, 0.2, 0.3], yaw: Math.PI / 2 }, frame: null, yaw: Math.PI / 2 },
  // an eighth turn about Y: lying flat, facing between +X and +Z
  "{ position, rotation } flat with a yaw": { raw: { position: [0.1, 0.2, 0.3], rotation: [0, Math.PI / 4, 0] }, frame: [[Q, 0, -Q], Y, [Q, 0, Q]] },
  // a domino rack's place: a quarter turn about Y, then about X — its X up, its Y toward +Z, its length (Z) along +X
  "{ position, rotation } standing on edge": { raw: { position: [0.1, 0.2, 0.3], rotation: [Math.PI / 2, Math.PI / 2, 0] }, frame: [Y, Z, X] },
  // −90° about X: +Z straight up, so no yaw
  "{ position, rotation } +Z straight up": { raw: { position: [0.1, 0.2, 0.3], rotation: [-Math.PI / 2, 0, 0] }, frame: [X, neg(Z), Y] },
};

/** Where the node sits (its translation), so the position's answer shows the whole matrix. */
export const AT = [1, 2, 3];

/** The yaw a direction faces, seen from above; null straight up or down. */
const yawOf = ([x, , z]) => (Math.hypot(x, z) < 1e-9 ? null : Math.atan2(x, z));

/** Every (form, node) pair with its answer: { position, frame: [X, Y, Z] images | null, yaw }. */
export function connectorCases() {
  const out = [];
  for (const [form, f] of Object.entries(FORMS)) {
    for (const [node, n] of Object.entries(NODES)) {
      const p = Array.isArray(f.raw) ? f.raw : f.raw.position;
      const position = n.turn(p.map((v, k) => v * n.scale[k])).map((v, k) => v + AT[k]);
      const frame = f.frame ? f.frame.map(n.turn) : null;
      // a whole frame: the yaw its Z faces; yaw only: the yaw the node turns that facing to
      const yaw = frame ? yawOf(frame[2]) : f.yaw == null ? null : yawOf(n.turn([Math.sin(f.yaw), 0, Math.cos(f.yaw)]));
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
