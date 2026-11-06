// Dice: which face is up, and a roll worked out ahead of time. Pure, no
// three.js, no stage.
//
// A die is any object with the trait `tabletop.die`: { faces? }, where
// `faces` says which number each of its own six sides shows, keyed by the
// local axis that points out of that side ("+y" is its top as modelled).
// The d6 part (parts.js) is drawn to the default map, opposite sides adding
// to seven. A die modelled elsewhere gets its map set in the inspector.
//
// A roll is a function of one seed: which side ends up, how it's turned about
// the up axis, how far it skids, and how many extra turns it tumbles. The
// roller draws the seed, plays the tumble as a pose hold and writes only the
// end (extension.js). Rotations are Euler XYZ, as the scene's transforms are
// (scene/src/transform.js): R = Rx · Ry · Rz.

/** The trait that makes an object a die. */
export const DIE = "tabletop.die";

/** Which number each side of a d6 shows, by the local axis out of that side. */
export const DEFAULT_FACES = Object.freeze({ "+y": 1, "-y": 6, "+x": 3, "-x": 4, "+z": 2, "-z": 5 });

/** The six local axes, by the name `faces` gives them. */
export const AXES = Object.freeze({
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
});

/** The highest number a side may show (what a peer may say it rolled: extension.js MESSAGES). */
export const MAX_FACE = 1000;

/** A die trait's faces, keeping only well-formed sides; the d6's when none is. */
export function facesOf(trait) {
  const f = trait?.faces;
  const out = {};
  if (f && typeof f === "object" && !Array.isArray(f)) {
    for (const k of Object.keys(AXES)) {
      const v = f[k];
      if (Number.isInteger(v) && v > 0 && v <= MAX_FACE) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : { ...DEFAULT_FACES };
}

// ─── 3 × 3 rotations, row-major ─────────────────────────────────────────────

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

const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((x) => x / l);
};

/** Two unit vectors square to `u` and to each other: the plane a die turns in about `u`. */
function plane(u) {
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const d = dot(ref, u);
  const p = unit(ref.map((v, i) => v - d * u[i]));
  return [p, cross(u, p)];
}

/** Which side of a die turned by `rotation` faces `up` (default world +Y): { key, value }. */
export function faceUp(rotation, faces = DEFAULT_FACES, up = [0, 1, 0]) {
  const m = Array.isArray(rotation?.[0]) ? rotation : eulerMatrix(rotation);
  let best = null;
  let bestDot = -Infinity;
  for (const [key, value] of Object.entries(faces)) {
    const d = dot(apply(m, AXES[key]), up);
    if (d > bestDot) {
      bestDot = d;
      best = { key, value };
    }
  }
  return best;
}

/**
 * The rotation that turns side `key` to face `up`, turned `theta` about
 * `up`: row-major 3 × 3. Exact: R a = u, R b = w, R (a × b) = u × w.
 */
export function restingOn(key, theta = 0, up = [0, 1, 0]) {
  const a = AXES[key];
  const b = a[0] ? [0, 0, 1] : [1, 0, 0];
  const ab = cross(a, b);
  const u = unit(up);
  const [p, q] = plane(u);
  const w = p.map((v, i) => Math.cos(theta) * v + Math.sin(theta) * q[i]);
  const uw = cross(u, w);
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => u[r] * a[c] + w[r] * b[c] + uw[r] * ab[c]));
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

/** How long a roll tumbles (s). */
export const ROLL_SECONDS = 0.6;
/** How high it's tossed (m, in its parent's frame). */
export const ROLL_LIFT = 0.06;
/** How far it may skid from where it was (m). */
export const ROLL_SKID = 0.02;

const tidy = (v) => +(+v).toFixed(6) + 0;

/**
 * A roll, worked out from its seed: where it ends up, what it shows, and
 * where it is part way.
 * @param {number} seed
 * @param {{
 *   from: { position: number[], rotation: number[], scale?: number },  // its local transform now
 *   faces?: { [axis]: number },
 *   pivot?: number[],   // what it turns about, in its own frame (the middle of its box)
 *   up?: number[],      // world up, in its parent's frame
 *   unitScale?: number, // the parent's scale: a skid is in metres
 * }} o
 * @returns {{ value: number, key: string, to: object, at(t: number): object }}
 */
export function rollPlan(seed, { from, faces = DEFAULT_FACES, pivot = [0, 0, 0], up = [0, 1, 0], unitScale = 1 }) {
  const rnd = seeded(seed);
  const keys = Object.keys(faces);
  const key = keys[Math.min(keys.length - 1, Math.floor(rnd() * keys.length))];
  const theta = rnd() * 2 * Math.PI;
  const skid = rnd() * ROLL_SKID;
  const heading = rnd() * 2 * Math.PI;
  // whole extra turns about each axis, either way, so it tumbles on its way and ends where it ends
  const spins = [0, 1, 2].map(() => (1 + Math.floor(rnd() * 2)) * (rnd() < 0.5 ? -1 : 1));

  const u = unit(up);
  const s = Number(from.scale) || 1;
  const r0 = [0, 1, 2].map((i) => Number(from.rotation?.[i]) || 0);
  const p0 = [0, 1, 2].map((i) => Number(from.position?.[i]) || 0);
  const centreOf = (pos, rot) => {
    const c = apply(eulerMatrix(rot), pivot);
    return pos.map((v, i) => v + s * c[i]);
  };
  const c0 = centreOf(p0, r0);
  const [p, q] = plane(u);
  const k = skid / (unitScale || 1);
  const c1 = c0.map((v, i) => v + k * (Math.cos(heading) * p[i] + Math.sin(heading) * q[i]));
  const r1 = matrixEuler(restingOn(key, theta, u)).map(tidy);
  const positionFor = (centre, rot) => {
    const c = apply(eulerMatrix(rot), pivot);
    return centre.map((v, i) => v - s * c[i]);
  };
  const to = { position: positionFor(c1, r1).map(tidy), rotation: r1, scale: s };
  const end = r1.map((v, i) => v + spins[i] * 2 * Math.PI);
  const lift = ROLL_LIFT / (unitScale || 1);
  return {
    key,
    value: faces[key],
    to,
    at(t) {
      const tt = Math.max(0, Math.min(1, t));
      const e = 1 - (1 - tt) * (1 - tt); // fast off the table, slowing as it lands
      const rot = r0.map((v, i) => v + (end[i] - v) * e);
      const h = lift * 4 * tt * (1 - tt);
      const centre = c0.map((v, i) => v + (c1[i] - v) * e + h * u[i]);
      return { position: positionFor(centre, rot), rotation: rot, scale: s };
    },
  };
}

/** The middle of an object's box in its own frame (its hint's bounds), else its origin. */
export function pivotOf(o) {
  const b = o?.hint?.bounds;
  if (!Array.isArray(b?.min) || !Array.isArray(b?.max)) return [0, 0, 0];
  return [0, 1, 2].map((i) => ((Number(b.min[i]) || 0) + (Number(b.max[i]) || 0)) / 2);
}

/** World up in the frame of a parent whose world matrix (column-major) is `m`: the matrix's second row, made unit. */
export const upIn = (m) => (m ? unit([m[1], m[5], m[9]]) : [0, 1, 0]);
/** A column-major matrix's scale (uniform). */
export const scaleOf = (m) => (m ? Math.hypot(m[0], m[1], m[2]) || 1 : 1);
