// Carrying: picking an object up and setting it down somewhere else on the
// table, the way a piece is moved in a board game. Pure (no three.js), so it
// can be tested; the viewport supplies the points and the ray hits.
//
// - What can be carried says so: the `scene.carry` trait (carryable below).
// - Connectors come from GLBs (`extras.connectors`, and the older
//   `extras.snapPoints`; see README). A dropped object's footprint centre goes
//   to the nearest one within its radius that accepts it (its tags), in plan
//   (x, z) only: height is decided by what is underneath.
// - Resting: the object is lowered until its box sits on the highest surface
//   under its footprint (a few rays straight down), or on the ground. No
//   physics: nothing tips, slides or bounces, and only the final pose is
//   written to the doc.

import { composeMatrix, decomposeMatrix } from "./transform.js";

/** The trait that says an object can be picked up: "can", as data (TOOLS.md §1). */
export const CARRY = "scene.carry";

/**
 * Can this object be carried, by what it is: it has the trait, isn't a
 * group and isn't locked. (Who holds it and what vetoes it now are the
 * carry part's to ask.)
 */
export const carryable = (o) => !!o && o.kind !== "group" && !o.locked && !!o.traits && typeof o.traits === "object" && Object.hasOwn(o.traits, CARRY) && o.traits[CARRY] != null;

/**
 * The yaw (radians about +Y) a rotation turns +Z to, seen from above: where
 * something set down facing that way faces. Euler XYZ radians (R = Rx·Ry·Rz).
 * null if it turns +Z straight up or down (within VERTICAL).
 */
export function yawOfEuler(rotation) {
  const [x, y] = rotation.map(Number);
  return yawOfDirection(Math.sin(y), Math.cos(x) * Math.cos(y));
}

/**
 * How near straight up or down (the length of its plan, for a unit vector) a
 * direction may be and still have no yaw: a GLB's frames are 32-bit floats,
 * so a connector pointing up on a turned node comes out a few 1e-8 off.
 */
const VERTICAL = 1e-6;

/** The yaw a unit direction with these plan components (x, z) faces; null within VERTICAL of straight up or down. */
const yawOfDirection = (x, z) => (Math.hypot(x, z) < VERTICAL ? null : Math.atan2(x, z));

const finite3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((r) => Number.isFinite(Number(r)));

/**
 * Clean connectors from a GLB: `extras.connectors`, a list of
 * { position: [x, y, z], rotation?: [x, y, z] (Euler XYZ radians), tags?:
 * string[] }, or the older `extras.snapPoints`, a list of [x, y, z] or
 * { position, yaw? }. The rotation is the connector's whole frame, kept; its
 * yaw (where it turns +Z, seen from above) is derived from it, never given
 * beside it, and the hand turns whatever is set down there to face that way —
 * a card in the far player's column reads the right way up for them. A
 * connector without a rotation says only its yaw (or nothing: null). A
 * connector with tags takes only objects with one of them (none: anything).
 * Anything malformed is dropped.
 * @returns {{ position: number[], rotation: number[] | null, yaw: number | null, tags: string[] }[]}
 */
export function sanitizeConnectors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    const v = Array.isArray(p) ? p : Array.isArray(p?.position) ? p.position : null;
    if (!v || v.length < 3) continue;
    const xyz = [Number(v[0]), Number(v[1]), Number(v[2])];
    if (!xyz.every(Number.isFinite)) continue;
    const rotation = !Array.isArray(p) && finite3(p?.rotation) ? p.rotation.slice(0, 3).map(Number) : null;
    const yaw = rotation ? yawOfEuler(rotation) : Array.isArray(p) || p.yaw == null ? null : Number(p.yaw);
    const tags = !Array.isArray(p) && Array.isArray(p?.tags) ? p.tags.filter((t) => typeof t === "string" && t) : [];
    out.push({ position: xyz, rotation, yaw: Number.isFinite(yaw) ? yaw : null, tags });
  }
  return out;
}

/** The linear part of a column-major 4×4 with each column made unit: a node's T·R·S with its scale's sizes taken out (a mirror's sign kept). */
function unitColumns(m) {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  for (let c = 0; c < 3; c++) {
    const len = Math.hypot(m[4 * c], m[4 * c + 1], m[4 * c + 2]) || 1;
    for (let r = 0; r < 3; r++) out[4 * c + r] = m[4 * c + r] / len;
  }
  return out;
}

const unit = (v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * A frame (column-major 4×4) carried by `r` (unitColumns of a node): its up
 * (Y) and facing (Z) go through r as directions, the up kept, the facing
 * squared to it, and X = Y × Z. So the result is a rotation whatever r is: a
 * mirrored node mirrors where a connector faces but never turns it inside
 * out or upside down, and a parent's uneven scale (which skews r's columns)
 * never shears it.
 */
function carryFrame(r, f) {
  const turn = (k) => [r[0] * f[k] + r[4] * f[k + 1] + r[8] * f[k + 2], r[1] * f[k] + r[5] * f[k + 1] + r[9] * f[k + 2], r[2] * f[k] + r[6] * f[k + 1] + r[10] * f[k + 2]];
  const y = unit(turn(4));
  const z0 = turn(8);
  const d = z0[0] * y[0] + z0[1] * y[1] + z0[2] * y[2];
  const z = unit([z0[0] - d * y[0], z0[1] - d * y[1], z0[2] - d * y[2]]);
  const x = cross(y, z);
  return [...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1];
}

/**
 * A clean connector (sanitizeConnectors) as seen from a frame `m` that holds
 * it (column-major 4×4: its node's matrix in the GLB, or its object's in the
 * world): the position through m, and the frame carried by m with its scale's
 * sizes left out (carryFrame: up kept, facing squared to it, right-handed, so
 * a mirror or a skewed parent never turns it inside out). A whole frame's yaw
 * is derived from the result. A yaw-only connector stays yaw-only: the yaw at
 * which m turns the direction it faces (+Z turned by its yaw), so on an
 * upright m it is the yaw plus m's own, and where m turns it straight up or
 * down it is null.
 * One source per connector: when `rotation` is there, yaw ≡ yawOfEuler(rotation).
 * @param {{ position: number[], rotation?: number[] | null, yaw?: number | null, tags?: string[] }} c
 * @param {ArrayLike<number>} m
 * @returns {{ position: number[], rotation: number[] | null, yaw: number | null, tags: string[] }}
 */
export function placeConnector(c, m) {
  const [x, y, z] = c.position.map(Number);
  const position = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  const tags = Array.isArray(c.tags) ? c.tags : [];
  const r = unitColumns(m);
  if (finite3(c.rotation)) {
    const rotation = decomposeMatrix(carryFrame(r, composeMatrix({ rotation: c.rotation.map(Number) }))).rotation;
    return { position, rotation, yaw: yawOfEuler(rotation), tags };
  }
  if (c.yaw == null || !Number.isFinite(Number(c.yaw))) return { position, rotation: null, yaw: null, tags };
  const fx = Math.sin(Number(c.yaw));
  const fz = Math.cos(Number(c.yaw));
  return { position, rotation: null, yaw: yawOfDirection(r[0] * fx + r[8] * fz, r[2] * fx + r[10] * fz), tags };
}

/**
 * How near level a unit axis may be (the size of its vertical part) and still
 * count as level, neither up nor down: a frame read from a GLB's 32-bit
 * floats, or decomposed and composed again, comes out a few 1e-8 off.
 */
export const LEVEL = 1e-6;

/** Which way its face (+Y) points: +1 up, −1 down, 0 level (within LEVEL). */
export function faceOf(m) {
  const v = m[5] / (Math.hypot(m[4], m[5], m[6]) || 1);
  return v > LEVEL ? 1 : v < -LEVEL ? -1 : 0;
}

/**
 * `W` turned into a connector's frame (`rotation`, Euler XYZ, in the frame
 * W is in): its body axes become the frame's, its own scale and its origin
 * kept. The frame as given, or the frame turned over about its own length
 * (its +Z, as F turns a piece) when that keeps the face the way `face` asks
 * (+1 up, −1 down, 0 either) and the frame's own face isn't level: a frame
 * that stands a piece on edge says alone which way it faces. Pure.
 */
export function intoFrame(W, rotation, face = 0) {
  const F = composeMatrix({ rotation });
  const up = F[5] > LEVEL ? 1 : F[5] < -LEVEL ? -1 : 0;
  const over = up !== 0 && face !== 0 && up !== face;
  const out = W.slice();
  for (let k = 0; k < 3; k++) {
    const s = Math.hypot(W[4 * k], W[4 * k + 1], W[4 * k + 2]);
    const sign = over && k < 2 ? -1 : 1; // turned over about its Z: X and Y reversed
    for (let r = 0; r < 3; r++) out[4 * k + r] = F[4 * k + r] * s * sign;
  }
  return out;
}

/** Does a connector with these tags take an object with those? (No tags on the connector: anything.) */
export function accepts(connectorTags, objectTags) {
  if (!connectorTags?.length) return true;
  return Array.isArray(objectTags) && objectTags.some((t) => connectorTags.includes(t));
}

/** The smallest turn (radians, −π..π) from yaw a to yaw b. */
export function yawDelta(a, b) {
  const d = (((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(d) < 1e-9 ? 0 : d;
}

/**
 * How close (in plan, world units) a footprint has to come to one of these
 * points to snap to it, when the GLB doesn't say: the half-diagonal of the
 * closest spacing (0.71 of it), so on a square grid every spot of a cell —
 * corners too — snaps to that cell's point, and a drop much past the edge
 * stays where it is. null for fewer than two points.
 */
export function defaultSnapRadius(points) {
  if (!points || points.length < 2) return null;
  let best = Infinity;
  // boards have tens of points, not thousands; cap the pairs anyway
  const n = Math.min(points.length, 2000);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = points[i].position ?? points[i];
      const b = points[j].position ?? points[j];
      const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (d > 1e-9 && d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best * Math.SQRT1_2 : null;
}

/**
 * The snap target for a footprint centred at (x, z): the nearest candidate
 * within its own radius, or null.
 * @param {{ world: number[], radius: number, yaw?: number | null }[]} candidates
 */
export function nearestSnap(candidates, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.world[0] - x, c.world[2] - z);
    if (d <= c.radius && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where to look straight down from, to find what a footprint (a world box's
 * plan, min/max [x, y, z]) would rest on: its centre and four points part way
 * to its corners. Inset, so a round piece doesn't land on the rim of its
 * neighbour through an empty corner of its box.
 * @returns {number[][]} [x, z] pairs
 */
export function footprintSamples(min, max, inset = 0.6) {
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const hx = ((max[0] - min[0]) / 2) * inset;
  const hz = ((max[2] - min[2]) / 2) * inset;
  return [
    [cx, cz],
    [cx - hx, cz - hz],
    [cx + hx, cz - hz],
    [cx - hx, cz + hz],
    [cx + hx, cz + hz],
  ];
}

/**
 * The surface a footprint rests on: the highest of the heights found under
 * its samples (null where a ray hit nothing), never below the ground.
 */
export function restHeight(hits, ground = 0) {
  let top = ground;
  for (const h of hits) if (h != null && Number.isFinite(h) && h > top) top = h;
  return top;
}

/** How high above where it will land a carried object floats: a little, so it reads as lifted. */
export function liftFor(height) {
  return Math.max(0.004, Math.min(0.05, height * 0.5));
}
