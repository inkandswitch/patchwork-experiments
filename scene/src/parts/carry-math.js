// The carry's maths (scene.carry, ./carry.js), as plain arrays so it can be
// tested without three.js or a stage. In place of a three.js group there is
// a world matrix the carry keeps itself: the part holds
// that pose on the stage and writes the final one to the doc.
//
// Matrices are 4×4 column-major (transform.js). A ray is { origin, dir }
// (arrays); `raycast(origin, dir)` → { id, point } | null is the stage's,
// already told to skip the carried object and what's attached to it.

import { accepts, defaultSnapRadius, faceOf, footprintSamples, intoSnap, liftFor, nearestSnap, placeConnector, sideOf } from "../carry-rules.js";
import { composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices } from "../transform.js";

const Y = [0, 1, 0];


/** The yaw (radians about +Y) a world matrix turns +Z to, seen from above. */
export const yawOfMatrix = (m) => Math.atan2(m[8], m[10]);

/** A pure rotation about a unit axis, column-major 4×4. */
function axisAngle(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** Turn a world matrix about a world axis through its own origin (three's rotateOnWorldAxis). */
export function rotateAbout(m, axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(len > 1e-12) || !angle) return m.slice();
  const out = multiplyMatrices(axisAngle([axis[0] / len, axis[1] / len, axis[2] / len], angle), m);
  out[12] = m[12];
  out[13] = m[13];
  out[14] = m[14];
  return out;
}

/** Turn it over about its own length (+Z in world): a card goes face down. */
export const flipMatrix = (m) => rotateAbout(m, [m[8], m[9], m[10]], Math.PI);

/**
 * How far its body sweeps out from its own length (+Z) as it turns over:
 * how high it must rise to turn without cutting the table. Pure.
 */
export function turnRadius(box, m) {
  const len = Math.hypot(m[8], m[9], m[10]) || 1;
  const a = [m[8] / len, m[9] / len, m[10] / len];
  let r = 0;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const v = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2]);
    const along = v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
    r = Math.max(r, Math.hypot(v[0] - along * a[0], v[1] - along * a[1], v[2] - along * a[2]));
  }
  return r;
}

/**
 * Part way (t from 0 to 1) through turning over into `m`: at 0 it hasn't
 * turned yet, at 1 it is `m`, and in between it rises `lift` (most at half
 * way) so it turns in the air. Pure.
 */
export function turning(m, t, lift = 0) {
  const k = Math.min(1, Math.max(0, t));
  const out = rotateAbout(m, [m[8], m[9], m[10]], -Math.PI * (1 - k));
  out[13] += lift * Math.sin(Math.PI * k);
  return out;
}

/**
 * How far above a carried piece's top, or the point the pointer is on
 * (whichever is higher), the rays that find what it rests on start: clear of
 * a pile or a block beside it, but under a boom swinging over the table or a
 * roof over the board (rays from the top of the whole scene came down on
 * those). At least a quarter metre, or the piece's own size.
 */
export const castClearance = (b) => Math.max(0.25, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);

/**
 * Turning a resting object over where it is (no carry): the matrix it ends
 * at, flipped and set back down on whatever is under its footprint (raycast
 * must skip it), and how high it rises on the way. The rays start just above
 * the turn it sweeps, not from the top of the scene. Pure; any frame (the
 * object's parent's, with its raycast) whose +Y is up.
 * @returns {{ to: number[], lift: number }}
 */
export function flipInPlace({ W, box, raycast }) {
  const turned = flipMatrix(W);
  const b = worldBox(box, turned);
  const centre = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
  const size = b.max[1] - b.min[1];
  const lift = turnRadius(box, W) + liftFor(size);
  const from = b.max[1] + lift;
  const land = landingFor({ W: turned, box, ray: { origin: [centre[0], from, centre[1]], dir: [0, -1, 0] }, raycast, castFrom: from });
  return { to: land ? translate(turned, land.delta) : turned, lift };
}

/** Part way through `flipInPlace`: from `from` to `to`, rising `lift` as it turns. Pure. */
export function flipAt(from, to, t, lift) {
  const k = Math.min(1, Math.max(0, t));
  const m = to.slice();
  for (let i = 12; i < 15; i++) m[i] = from[i] + (to[i] - from[i]) * k;
  return turning(m, k, lift);
}

/** Move a world matrix by a world translation. */
export function translate(m, d) {
  const out = m.slice();
  out[12] += d[0];
  out[13] += d[1];
  out[14] += d[2];
  return out;
}

/** A body-space box ({ min, max }) under a world matrix, boxed again in world. */
export function worldBox(box, m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** The local transform (doc-shaped) that shows a world matrix under a parent's (null: the scene root). */
export function localTransform(parentWorld, world) {
  const inv = parentWorld ? invertMatrix(parentWorld) : null;
  return decomposeMatrix(inv ? multiplyMatrices(inv, world) : world);
}

/** Each connectors list's defaultSnapRadius (0: none), worked out once per list. */
const defaultRadii = new WeakMap();

/** How far an object's connectors reach: its content's `snapRadius`, else defaultSnapRadius of them. */
function snapRadiusOf(o) {
  const given = Number(o.snapRadius);
  if (given) return given;
  if (!defaultRadii.has(o.connectors)) defaultRadii.set(o.connectors, defaultSnapRadius(o.connectors) || 0);
  return defaultRadii.get(o.connectors);
}

/**
 * Where a carried object with these tags may snap: each other object's
 * connectors (body space) in world (placeConnector: a whole frame turned by
 * the object's rotation, yaw derived from it; a yaw-only one turned by the
 * object's yaw), and the radius (the content's `snapRadius`, else
 * defaultSnapRadius of its connectors) scaled by its plan scale. A tagged connector
 * takes only objects with one of its tags. `rotation` is the connector's
 * whole frame in world (Euler XYZ), or null where it gives only a yaw.
 * @param {{ id: string, matrix: number[], connectors: { position: number[], rotation?: number[] | null, yaw?: number | null, tags?: string[] }[], snapRadius?: number | null }[]} others
 * @param {string[]} tags
 * @returns {{ world: number[], rotation: number[] | null, yaw: number | null, radius: number, objectId: string }[]}
 */
export function snapCandidates(others, tags) {
  const out = [];
  for (const o of others ?? []) {
    const m = o?.matrix;
    if (!m || !Array.isArray(o.connectors) || !o.connectors.length) continue;
    const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
    const radius = snapRadiusOf(o) * scale;
    if (!(radius > 0)) continue;
    for (const p of o.connectors) {
      if (!Array.isArray(p?.position) || !accepts(p.tags, tags)) continue;
      const c = placeConnector(p, m);
      out.push({ world: c.position, rotation: c.rotation, yaw: c.yaw, radius, objectId: o.id });
    }
  }
  return out;
}

/** Where a ray meets the table: the first object it hits, else the ground (y = 0); null looking at the sky. */
export function tablePoint(ray, raycast) {
  if (!ray?.origin || !ray?.dir) return null;
  const hit = raycast?.(ray.origin, ray.dir) ?? null;
  if (hit?.point) return { point: hit.point, id: hit.id ?? null };
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  if (Math.abs(dy) < 1e-12) return null;
  const t = -oy / dy;
  if (!(t >= 0)) return null;
  return { point: [ox + dx * t, 0, oz + dz * t], id: null };
}

/**
 * Where an object at world matrix `W` (its body box `box`) would land with
 * the pointer's ray here: the world translation that puts it down, the
 * ring's spot and size, whether it snapped (and the yaw that asks for), how
 * high to float it, and what it rests on (`on`: an object id, or null for the
 * ground). null when the ray finds no table. Any frame whose +Y is up (the
 * hand works in the carried object's parent's), with a raycast in it;
 * `castFrom`, the height the rays down start at, defaults to castClearance
 * above the piece or the pointer's point.
 */
export function landingFor({ W, box, ray, offset = [0, 0], alt = false, snaps = [], raycast, castFrom = null }) {
  const b = worldBox(box, W);
  const at = tablePoint(ray, raycast);
  if (!at) return null;
  const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  let tx = at.point[0] + offset[0];
  let tz = at.point[2] + offset[1];
  const snap = alt ? null : nearestSnap(snaps, tx, tz);
  if (snap) {
    tx = snap.world[0];
    tz = snap.world[2];
  }
  const dx = tx - center[0];
  const dz = tz - center[2];
  // the rays down start just above it, or what the pointer is on, whichever is higher (castClearance)
  const top = Number.isFinite(castFrom) ? castFrom : Math.max(b.max[1], at.point[1]) + castClearance(b);
  let rest = 0;
  let on = null;
  for (const [x, z] of footprintSamples([b.min[0] + dx, 0, b.min[2] + dz], [b.max[0] + dx, 0, b.max[2] + dz])) {
    const h = downOnto(raycast, x, top, z);
    const y = h?.point?.[1];
    if (Number.isFinite(y) && y > rest) {
      rest = y;
      on = h.id ?? null;
    }
  }
  return {
    delta: [dx, rest - b.min[1], dz],
    rest,
    spot: [tx, rest, tz],
    radius: Math.max(size[0], size[2]) / 2,
    snapped: !!snap,
    yaw: snap?.yaw ?? null,
    frame: snap?.rotation ?? null,
    lift: liftFor(size[1]),
    on: on ?? snap?.objectId ?? null,
  };
}

/**
 * What a ray straight down from (x, from, z) comes to rest on. A start
 * inside something (a block taller than the clearance beside the pointer)
 * says so: its ray down meets that thing's underside from behind, and one
 * up meets its top from behind (`back`, the stage's raycast); the ray then
 * starts again just over that top, and lands on it. A ray up that meets a
 * face from in front (a boom's underside overhead) is no such thing: what
 * the first ray found stands. A few steps at most (things inside things).
 */
export function downOnto(raycast, x, from, z) {
  let h = raycast?.([x, from, z], [0, -1, 0]) ?? null;
  for (let i = 0; i < 4 && h?.back; i++) {
    const up = raycast([x, from, z], [0, 1, 0]);
    const y = up?.point?.[1];
    if (!up?.back || !Number.isFinite(y) || !(y > from)) break;
    from = y + 1e-4;
    h = raycast([x, from, z], [0, -1, 0]) ?? null;
  }
  return h;
}

// ─── how it lies where it lands (pure) ──────────────────────────────────────

/** A matrix's column k made unit: the way it turns its body's axis k. */
const axisOf = (m, k) => {
  const len = Math.hypot(m[4 * k], m[4 * k + 1], m[4 * k + 2]) || 1;
  return [m[4 * k] / len, m[4 * k + 1] / len, m[4 * k + 2] / len];
};

/**
 * `W` lying on its broadest face: the smallest turn (about a level axis,
 * through its origin) that brings its thinnest body axis (`box`, as W scales
 * it) upright. Of axes equally thin, the most upright already, then +Y, +X,
 * +Z. That axis ends pointing the way it lay (sideOf: up or down when it is
 * the most upright of the three); one on an edge or an end (a tile standing)
 * ends up. So a piece lying flat already is left as it is, and the way its
 * length points, seen from above, is kept wherever its length was level.
 * Pure.
 */
export function layFlat(W, box) {
  const size = [0, 1, 2].map((k) => Math.abs(box.max[k] - box.min[k]) * Math.hypot(W[4 * k], W[4 * k + 1], W[4 * k + 2]));
  const thin = Math.min(...size);
  let k = -1;
  for (const c of [1, 0, 2]) {
    if (size[c] > thin * (1 + 1e-9)) continue;
    if (k < 0 || Math.abs(axisOf(W, c)[1]) > Math.abs(axisOf(W, k)[1]) + 1e-12) k = c;
  }
  const a = axisOf(W, k);
  const to = sideOf(W, k) < 0 ? -1 : 1;
  // the turn from a to (0, to, 0): about a × (0, to, 0), by the angle between them
  const axis = [-a[2] * to, 0, a[0] * to];
  const angle = Math.atan2(Math.hypot(axis[0], axis[2]), a[1] * to);
  return angle > 1e-12 ? rotateAbout(W, axis, angle) : W.slice();
}

/**
 * How a carried piece lies where it lands: a pure function of how it is
 * held (`own`: as picked up, with every Q/E turn and F since), the snap it
 * goes to (`snap`: a connector's { rotation, yaw } in this frame, or null)
 * and what the landing rules answer there (`answer`: { faceUp?, flat? };
 * faceUp only while `faceYou`, as picked up where nothing asked it).
 * Nothing else turns it.
 *
 *   1. flat: layFlat (on its broadest face; one standing on edge face up).
 *   2. faceUp: turned over (F's turn) if its face is down (faceOf).
 *   3. the snap: carry-rules intoSnap, a connector's whole frame (face up or
 *      down as 1 and 2 left it; a frame that stands it on edge decides
 *      alone), else its yaw (about the vertical).
 *
 * With no snap and no answer it is `own`. Returns the pose `W`, `held` (it
 * after 1 and 2: what F turns over, as seen), `turned` (2 turned it over)
 * and `stands` (the snap's frame stands it on an edge or an end, so which
 * way up it was held doesn't show).
 * @returns {{ W: number[], held: number[], turned: boolean, stands: boolean }}
 */
export function landedPose(own, box, { snap = null, answer = null, faceYou = false } = {}) {
  let held = answer?.flat ? layFlat(own, box) : own.slice();
  let turned = false;
  if (faceYou && answer?.faceUp && faceOf(held) < 0) {
    held = flipMatrix(held);
    turned = true;
  }
  const stands = Array.isArray(snap?.rotation) && faceOf(composeMatrix({ rotation: snap.rotation })) === 0;
  return { W: intoSnap(held, snap), held, turned, stands };
}

/**
 * One carry: an object picked up at world matrix `W`. It keeps where the
 * object is now (`state.W`, floating while carried) and answers where it
 * would land.
 * @param {{
 *   id: string, W: number[], box: { min: number[], max: number[] },
 *   offset?: number[],                       // [x, z]: where it was grabbed, from its footprint's centre
 *   snaps?: object[],                        // snapCandidates
 *   raycast: (origin: number[], dir: number[]) => { id?: string, point: number[] } | null,
 *   landing?: (id: string, worldPoint: number[], hitId: string | null) => { faceUp?: boolean, flat?: boolean } | null,
 * }} o
 */
export function createCarry({ id, W, box, offset = [0, 0], snaps = [], raycast, landing = () => null }) {
  const state = {
    W: W.slice(),
    // how it is held: as picked up, with every turn (Q/E) and F since. Where it
    // shows (W) is landedPose of this, so a snap's or a rule's turn lasts only
    // while it is over that snap or that rule's place.
    own: W.slice(),
    held: null, // landedPose's `held`, last time: what F turns over
    raised: false, // landedPose's `turned`, last time: held is own turned over
    last: null, // { ray, alt }: the pointer the last move had
    land: null,
    // picked up where nothing asks it to face up: it turns face up while over somewhere that does
    faceYou: !landing(id, W.slice(12, 15), null)?.faceUp,
    // Turning over, counted as it shows: `over` is how many times own is
    // turned over from how it was picked up (F's), odd or even; what shows is
    // that and a faceUp turn, except in a frame that stands it, where which
    // way up it is held doesn't show. `shown` is that, the last time it showed.
    over: 0,
    shown: 0,
    flips: 0, // times what shows has turned over: the part shows each one turning in the air
  };
  const landOf = (M, ray, alt) => landingFor({ W: M, box, ray, offset, alt, snaps, raycast });
  /** A pose at where it is now. */
  const here = (M) => {
    const out = M.slice();
    out[12] = state.W[12];
    out[13] = state.W[13];
    out[14] = state.W[14];
    return out;
  };
  /** It shows this way up now (0 as picked up, 1 turned over): one more turn over to show, if that's new. */
  const shows = (parity) => {
    if (parity === state.shown) return;
    state.shown = parity;
    state.flips++;
  };
  const same = (a, b) => a.every((v, i) => v === b[i]);

  // Where it lands from this pointer, and how it lies there (landedPose). The
  // snap is the pointer's (where, not how it is turned); the rules are asked
  // where it would go down turned to that snap; it is posed by their answer
  // and landed again as it then lies.
  function settle(ray, alt) {
    const own = here(state.own);
    const first = landOf(own, ray, alt);
    if (!first) return null;
    const snap = first.snapped ? { rotation: first.frame, yaw: first.yaw } : null;
    const S = snap ? landedPose(own, box, { snap }).W : own;
    const there = snap ? (landOf(S, ray, alt) ?? first) : first;
    const answer = landing(id, [S[12] + there.delta[0], S[13] + there.delta[1], S[14] + there.delta[2]], there.on) ?? null;
    const p = landedPose(own, box, { snap, answer, faceYou: state.faceYou });
    state.held = p.held;
    state.raised = p.turned;
    state.W = p.W;
    if (!p.stands) shows(state.over ^ (p.turned ? 1 : 0));
    return same(p.W, S) ? there : (landOf(p.W, ray, alt) ?? there);
  }

  const again = () => (state.last ? move(state.last.ray, state.last.alt) : null);

  /** Follow the pointer: float it just above where it would land. @returns the landing, or null */
  function move(ray, alt = false) {
    state.last = { ray, alt: !!alt };
    const land = settle(ray, !!alt);
    if (!land) return null;
    state.W = translate(state.W, [land.delta[0], land.delta[1] + land.lift, land.delta[2]]);
    state.land = land;
    return land;
  }

  return {
    state,
    move,
    /** The same pointer, with Alt now held or let go. */
    alt: (alt) => (state.last ? move(state.last.ray, alt) : null),
    /** Turn it about the vertical (radians; + is anticlockwise seen from above). */
    turn(angle) {
      state.own = rotateAbout(here(state.own), Y, angle);
      if (!state.last) state.W = state.own.slice();
      return again();
    },
    /**
     * Turn it over as you see it (laid flat, turned face up: `held`). It's up
     * to you now, so nowhere turns it face up any more; flat is still asked.
     */
    flip() {
      state.own = flipMatrix(here(state.held ?? state.own));
      state.over ^= (state.raised ? 1 : 0) ^ 1;
      state.faceYou = false;
      state.raised = false;
      if (state.last) return again();
      state.W = state.own.slice();
      shows(state.over);
      return null;
    },
    /** Put it down (re-landed from this pointer, else the last): `{ W, on }` (its world matrix and what it rests on), or null if it never had a landing. */
    put(ray = null, alt = null) {
      if (!state.land) return null;
      const r = ray ?? state.last?.ray;
      const land = (r ? settle(r, alt ?? state.last?.alt ?? false) : null) ?? state.land;
      state.W = translate(state.W, land.delta);
      return { W: state.W, on: land.on ?? null };
    },
  };
}
