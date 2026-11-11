// A die in a scene, as rotations: which face is up, the pose that rests it on
// a face, a roll worked out ahead of time from one seed, and a turn by hand.
// Pure: no three.js, no stage.
//
// All of it works from a BUILT die: what a die's GLB says about itself in
// `extras.dice` (die-glb.js builtDie), which is the only place a scene learns
// a die's faces from. In metres, in the GLB's own frame:
//
//   { v: 1, shape, turnOnly,
//     centre: [x, y, z],              // the solid's middle (the GLB's origin is under it, on the table)
//     verts: [[x, y, z], …],          // its corners, from the middle
//     faces: [{ up: [x, y, z], rest, label }, …] }   // by outcome: the direction that points up when it shows,
//                                                     // how high its middle then is, and what it's called
//
// A die lies ON ITS PARENT: "up" is its parent's +Y (the world's, at the
// root), and resting means its lowest corners are level in that frame. So a
// die on a table aboard a heeling ship lies flat on the table, and is read
// against the table, not the horizon. Transforms are the scene's: { position,
// rotation (Euler XYZ), scale }, in the parent's frame.

import { add, apply, axisAngle, cross, dot, eulerMatrix, matrixEuler, mul, rotationBetween, scale as times, seeded, squareTo, sub, toAxisAngle, transpose, unit } from "./m3.js";

const UP = Object.freeze([0, 1, 0]);

/** What a built die must be to be read: null unless it's well-formed. */
export function builtOf(x) {
  if (!x || typeof x !== "object" || x.v !== 1) return null;
  const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!vec(x.centre) || !Array.isArray(x.verts) || x.verts.length < 4 || x.verts.length > 256 || !x.verts.every(vec)) return null;
  if (!Array.isArray(x.faces) || x.faces.length < 2 || x.faces.length > 100) return null;
  for (const f of x.faces) {
    if (!vec(f?.up) || Math.abs(Math.hypot(...f.up) - 1) > 1e-3 || !(f.rest > 0) || typeof f.label !== "string") return null;
  }
  return x;
}

const matrixOf = (rotation) => (Array.isArray(rotation?.[0]) ? rotation : eulerMatrix(rotation));

/**
 * Which face of a die turned by `rotation` (Euler XYZ, or a 3 × 3) is up in
 * its parent's frame: the index of the face whose `up` points most nearly
 * along +Y. Any orientation gives an answer (the lowest index of the best).
 */
export function faceUp(rotation, built) {
  const m = matrixOf(rotation);
  let best = -1;
  let bestDot = -Infinity;
  built.faces.forEach((f, i) => {
    // (m · up) · +Y is the matrix's second row against up
    const d = dot(m[1], f.up);
    if (d > bestDot + 1e-12) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

/**
 * The rotation that shows face `i`, turned `theta` about the vertical:
 * row-major 3 × 3. Exact: R a = +Y, R b = w, R (a × b) = +Y × w, for a
 * frame (a, b) fixed to the face and w the heading.
 */
export function showing(built, i, theta = 0) {
  const a = unit(built.faces[i].up);
  const b = squareTo(a);
  const ab = cross(a, b);
  const w = [Math.cos(theta), 0, -Math.sin(theta)];
  const uw = cross(UP, w);
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => UP[r] * a[c] + w[r] * b[c] + uw[r] * ab[c]));
}

/** How far a die turned by `m` reaches below its middle (its own units, before its scale). */
export function reach(built, m) {
  let low = Infinity;
  for (const v of built.verts) low = Math.min(low, dot(m[1], v));
  return -low;
}

const tidy = (v) => +(+v).toFixed(6) + 0;
const numbers = (v) => [0, 1, 2].map((i) => Number(v?.[i]) || 0);

/** A die's middle in its parent's frame, at a transform. */
export function middleAt(built, t) {
  const s = Number(t?.scale) || 1;
  return add(numbers(t?.position), times(apply(matrixOf(t?.rotation ?? [0, 0, 0]), built.centre), s));
}

/** The transform that puts a die's middle at `middle`, turned by the 3 × 3 `m` (written as the doc keeps it: six places). */
function transformAt(built, middle, m, s) {
  const rotation = matrixEuler(m).map(tidy);
  // from the rotation as written, so the middle is where it was meant to the last place
  const position = sub(middle, times(apply(eulerMatrix(rotation), built.centre), s)).map(tidy);
  return { position, rotation, scale: s };
}

/** The height of what a die at `from` stands on: its lowest corner, in its parent's frame. */
function floorUnder(built, from, s) {
  const m0 = matrixOf(from.rotation ?? [0, 0, 0]);
  return middleAt(built, from)[1] - s * reach(built, m0);
}

/** How long a roll tumbles (s). */
export const ROLL_SECONDS = 0.7;
/** How high it's tossed (m). */
export const ROLL_LIFT = 0.06;
/** How far it may skid from where it was (m). */
export const ROLL_SKID = 0.02;

/**
 * Which face a seed lands: its remainder by the number of faces. So the
 * seeds 0 … n − 1 land the faces 0 … n − 1, each once, and every face is
 * reachable by construction; a seed drawn evenly from 0 … 2³² − 1 lands each
 * face evenly but for a part in 2³² ÷ n (2³² is not a multiple of every n).
 */
export const faceOfSeed = (seed, n) => (seed >>> 0) % n;

/**
 * A roll, worked out from its seed: the face it lands on, where it ends up,
 * and where it is part way. It ends at rest on what it stood on: the face
 * shown level, the die's lowest corners on the height its lowest corner had.
 * @param {number} seed  a 32-bit unsigned integer
 * @param {{
 *   built: object,                                            // the die, as built
 *   from: { position: number[], rotation: number[], scale?: number },   // its transform now, in its parent's frame
 *   unitScale?: number,   // the parent's scale in the world: a skid and a toss are in metres
 *   skid?: number,        // how far it may skid (m)
 * }} o
 * @returns {{ face: number, to: object, at(t: number): object }}
 */
export function rollPlan(seed, { built, from, unitScale = 1, skid = ROLL_SKID }) {
  const n = built.faces.length;
  const face = faceOfSeed(seed, n);
  // everything else about the roll is how it looks, drawn from the same seed
  const rnd = seeded(seed);
  const theta = rnd() * 2 * Math.PI;
  const far = (rnd() * skid) / (unitScale || 1);
  const heading = rnd() * 2 * Math.PI;
  const turns = 1 + Math.floor(rnd() * 2);
  const wobble = (1 + Math.floor(rnd() * 2)) * (rnd() < 0.5 ? -1 : 1);
  const z = rnd() * 2 - 1;
  const phi = rnd() * 2 * Math.PI;
  const spare = [Math.sqrt(1 - z * z) * Math.cos(phi), z, Math.sqrt(1 - z * z) * Math.sin(phi)];

  const s = Number(from.scale) || 1;
  const m0 = matrixOf(numbers(from.rotation));
  const c0 = middleAt(built, { ...from, scale: s });
  const floor = floorUnder(built, from, s);
  const m1 = showing(built, face, theta);
  const c1 = [c0[0] + far * Math.cos(heading), floor + s * built.faces[face].rest, c0[2] + far * Math.sin(heading)];
  const to = transformAt(built, c1, m1, s);

  // the way there: the least turn from the start to the end, with whole turns
  // more about the same axis, and whole turns of a wobble about another, so
  // it starts as it lies, ends as it lands, and tumbles between
  const { axis, angle } = toAxisAngle(mul(m1, transpose(m0)), spare);
  const lift = ROLL_LIFT / (unitScale || 1);
  return {
    face,
    to,
    at(t) {
      const tt = Math.max(0, Math.min(1, t));
      const e = 1 - (1 - tt) * (1 - tt); // fast off the table, slowing as it lands
      const m = mul(mul(axisAngle(axis, e * (angle + 2 * Math.PI * turns)), axisAngle(spare, e * 2 * Math.PI * wobble)), m0);
      const middle = [c0[0] + (c1[0] - c0[0]) * e, c0[1] + (c1[1] - c0[1]) * e + lift * 4 * tt * (1 - tt), c0[2] + (c1[2] - c0[2]) * e];
      return { position: sub(middle, times(apply(m, built.centre), s)), rotation: matrixEuler(m), scale: s };
    },
  };
}

/**
 * A die turned by hand to show face `i`: by the least turn that brings it
 * up, staying where it is in plan and set down on what it stood on.
 * @returns {{ position, rotation, scale }}
 */
export function turnTo(built, i, from) {
  const s = Number(from.scale) || 1;
  const m0 = matrixOf(numbers(from.rotation));
  const c0 = middleAt(built, { ...from, scale: s });
  const floor = floorUnder(built, from, s);
  const m1 = mul(rotationBetween(apply(m0, unit(built.faces[i].up)), [...UP]), m0);
  const to = transformAt(built, [c0[0], floor + s * built.faces[i].rest, c0[2]], m1, s);
  // already lying that way: exactly as it is (the same turn can be written as other angles)
  const same = eulerMatrix(to.rotation).flat().every((v, k) => Math.abs(v - m0.flat()[k]) < 1e-5) && to.position.every((v, k) => Math.abs(v - (Number(from.position?.[k]) || 0)) < 1e-6);
  return same ? { position: numbers(from.position), rotation: numbers(from.rotation), scale: s } : to;
}

/** A seed for one die of several thrown together, from the throw's seed: a different, fixed one per place. */
export function seedFor(seed, k) {
  // (a round of mulberry32's mixing, keyed by the place)
  let t = ((seed >>> 0) + Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * The randomness of a roll: one unsigned 32-bit seed, from which the whole
 * roll follows (rollPlan). Today it is this view's own draw, which the other
 * players take on trust. A fair seed, drawn jointly so that no one player
 * chooses it (commit and reveal among those at the table), will replace this
 * one function; nothing else about a roll needs to change.
 */
export function drawSeed() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/** A column-major 4 × 4's scale (uniform): a parent's, to turn metres into its units. */
export const scaleOf = (m) => (m ? Math.hypot(m[0], m[1], m[2]) || 1 : 1);
