// The hand's carry maths (scene.hand, ./hand.js), as plain arrays so it can be
// tested without three.js or a stage. This is the old viewport's
// startCarry / landingFor / settle / flipCarried / endCarry with the three.js
// group swapped for a world matrix the carry keeps itself: the part holds
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
 * ground). null when the ray finds no table.
 */
export function landingFor({ W, box, ray, offset = [0, 0], alt = false, snaps = [], raycast, sceneTop = null }) {
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
  const top = Math.max(b.max[1], Number.isFinite(sceneTop) ? sceneTop : 0) + 1;
  let rest = 0;
  let on = null;
  for (const [x, z] of footprintSamples([b.min[0] + dx, 0, b.min[2] + dz], [b.max[0] + dx, 0, b.max[2] + dz])) {
    const h = raycast?.([x, top, z], [0, -1, 0]) ?? null;
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
 * One carry: an object picked up at world matrix `W`. It keeps where the
 * object is now (`state.W`, floating while carried) and answers where it
 * would land.
 * @param {{
 *   id: string, W: number[], box: { min: number[], max: number[] },
 *   offset?: number[],                       // [x, z]: where it was grabbed, from its footprint's centre
 *   snaps?: object[],                        // snapCandidates
 *   raycast: (origin: number[], dir: number[]) => { id?: string, point: number[] } | null,
 *   sceneTop?: () => number | null,
 *   landing?: (id: string, worldPoint: number[], hitId: string | null) => { faceUp?: boolean } | null,
 * }} o
 */
export function createCarry({ id, W, box, offset = [0, 0], snaps = [], raycast, sceneTop = () => null, landing = () => null }) {
  const state = {
    W: W.slice(),
    last: null, // { ray, alt }: the pointer the last move had
    land: null,
    // picked up where nothing asks it to face up: it turns face up while over somewhere that does
    faceYou: !landing(id, W.slice(12, 15), null)?.faceUp,
    turned: false,
  };
  const landFrom = (ray, alt) => landingFor({ W: state.W, box, ray, offset, alt, snaps, raycast, sceneTop: sceneTop() });

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
