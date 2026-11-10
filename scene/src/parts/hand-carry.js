// The hand's carry maths (scene.hand, ./hand.js), as plain arrays so it can be
// tested without three.js or a stage. In place of a three.js group there is
// a world matrix the carry keeps itself: the part holds
// that pose on the stage and writes the final one to the doc.
//
// Matrices are 4×4 column-major (transform.js). A ray is { origin, dir }
// (arrays); `raycast(origin, dir)` → { id, point } | null is the stage's,
// already told to skip the carried object and what's attached to it.

import { accepts, footprintSamples, liftFor, nearestSnap, yawDelta } from "../hand.js";
import { decomposeMatrix, invertMatrix, multiplyMatrices } from "../transform.js";

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

/**
 * Where a carried object with these tags may snap: each other object's
 * connectors (body space) in world, with their yaw turned by the object's,
 * and the radius scaled by its plan scale. A tagged connector takes only
 * objects with one of its tags.
 * @param {{ id: string, matrix: number[], connectors: { position: number[], yaw?: number | null, tags?: string[] }[], snapRadius?: number | null }[]} others
 * @param {string[]} tags
 * @returns {{ world: number[], yaw: number | null, radius: number, objectId: string }[]}
 */
export function snapCandidates(others, tags) {
  const out = [];
  for (const o of others ?? []) {
    const m = o?.matrix;
    if (!m || !Array.isArray(o.connectors) || !o.connectors.length) continue;
    const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
    const radius = (Number(o.snapRadius) || 0) * scale;
    if (!(radius > 0)) continue;
    const turn = yawOfMatrix(m);
    for (const p of o.connectors) {
      if (!Array.isArray(p?.position) || !accepts(p.tags, tags)) continue;
      const [x, y, z] = p.position;
      out.push({
        world: [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
        yaw: p.yaw == null ? null : p.yaw + turn,
        radius,
        objectId: o.id,
      });
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

/**
 * One carry: an object picked up at world matrix `W`. It keeps where the
 * object is now (`state.W`, floating while carried) and answers where it
 * would land.
 * @param {{
 *   id: string, W: number[], box: { min: number[], max: number[] },
 *   offset?: number[],                       // [x, z]: where it was grabbed, from its footprint's centre
 *   snaps?: object[],                        // snapCandidates
 *   raycast: (origin: number[], dir: number[]) => { id?: string, point: number[] } | null,
 *   landing?: (id: string, worldPoint: number[], hitId: string | null) => { faceUp?: boolean } | null,
 * }} o
 */
export function createCarry({ id, W, box, offset = [0, 0], snaps = [], raycast, landing = () => null }) {
  const state = {
    W: W.slice(),
    last: null, // { ray, alt }: the pointer the last move had
    land: null,
    // picked up where nothing asks it to face up: it turns face up while over somewhere that does
    faceYou: !landing(id, W.slice(12, 15), null)?.faceUp,
    turned: false,
    flips: 0, // times it has turned over: the part shows each one turning in the air
  };
  const landFrom = (ray, alt) => landingFor({ W: state.W, box, ray, offset, alt, snaps, raycast });

  // Where it lands from this pointer: a snap with a yaw turns it to face that
  // way first; somewhere that asks for it face up turns it face up (and back
  // over if it leaves, so it can't go down face up elsewhere by accident).
  function settle(ray, alt) {
    let land = landFrom(ray, alt);
    if (land?.yaw != null) {
      const turn = yawDelta(yawOfMatrix(state.W), land.yaw);
      if (turn) {
        state.W = rotateAbout(state.W, Y, turn);
        land = landFrom(ray, alt) ?? land;
      }
    }
    if (land && state.faceYou) {
      const p = [state.W[12] + land.delta[0], state.W[13] + land.delta[1], state.W[14] + land.delta[2]];
      const want = !!landing(id, p, land.on)?.faceUp;
      if (want ? !state.turned && state.W[5] <= 1e-6 : state.turned) {
        state.W = flipMatrix(state.W);
        state.flips++;
        state.turned = want;
        land = landFrom(ray, alt) ?? land;
      }
    }
    return land;
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
      state.W = rotateAbout(state.W, Y, angle);
      return again();
    },
    /** Turn it over; it's up to you now, so nowhere turns it face up any more. */
    flip() {
      state.W = flipMatrix(state.W);
      state.flips++;
      state.faceYou = false;
      return again();
    },
    /** Put it down (re-landed from this pointer, else the last): its world matrix, or null if it never had a landing. */
    put(ray = null, alt = null) {
      if (!state.land) return null;
      const r = ray ?? state.last?.ray;
      const land = (r ? settle(r, alt ?? state.last?.alt ?? false) : null) ?? state.land;
      state.W = translate(state.W, land.delta);
      return state.W;
    },
  };
}
