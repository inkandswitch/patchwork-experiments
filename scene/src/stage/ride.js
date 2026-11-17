// Riding along (STAGE.md, "Picking and camera": `camera.ride`): the orbit
// camera carried by a moving object, as a passenger is. Each frame, after
// the loops have moved what's drawn and before the orbit updates, the camera
// and its orbit target move by how the object moved since the last frame:
// the shift of a point of it (`at`, in its frame: its origin unless said;
// a seat rides the spot on the table it looks at, so that spot holds still
// on screen however she rolls), its turn about the vertical through that
// point (`turn`), and its rise and fall (`rise`). Roll and pitch are
// followed only by a ride that says `tilt`: then the camera moves with the
// object whole, as a passenger does, and its up is the object's (a seat at a
// table rolls with the table: the boat is how the boat is). Otherwise the
// orbit keeps world up.
//
// Only one ride applies at a time (STAGE.md, "Bodies"): the current body's, when
// it has one (a seat rides its table), else the latest base ride (orbit
// rides it: a ship keeping herself in view). So a seat at a table aboard a
// ship wins over the ship's follow with no flag: it is the body's. A ride
// starting to apply, or the camera held (first person), re-baselines it: it
// never moves the camera for a frame it didn't see. Pure: plain arrays, no
// three.js.

/** Where a point of an object (`at`, in its frame; its origin) is and which way it heads, from its world matrix (column-major): what a ride follows. */
export function rideFrame(m, at = null) {
  const p = at ? [0, 1, 2].map((r) => m[r] * at[0] + m[4 + r] * at[1] + m[8 + r] * at[2] + m[12 + r]) : [m[12], m[13], m[14]];
  return { p, yaw: Math.atan2(m[8], m[10]), m: [...m] };
}

/** The object's up (its +Y) in the world, unit, from its world matrix. */
export function upOf(m) {
  const l = Math.hypot(m[4], m[5], m[6]) || 1;
  return [m[4] / l, m[5] / l, m[6] / l];
}

/**
 * How a point moves with an object whole from one frame to the next: by
 * the rigid motion now · last⁻¹ (its turn, roll, pitch and shift). Pure.
 */
export function wholeMove(last, now) {
  const a = last.m;
  const b = now.m;
  // last's inverse, for a similarity: transpose of its rotation over its scale²
  const s2 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2] || 1;
  const inv = (q) => {
    const x = q[0] - a[12];
    const y = q[1] - a[13];
    const z = q[2] - a[14];
    return [(a[0] * x + a[1] * y + a[2] * z) / s2, (a[4] * x + a[5] * y + a[6] * z) / s2, (a[8] * x + a[9] * y + a[10] * z) / s2];
  };
  return (q) => {
    const l = inv(q);
    return [0, 1, 2].map((r) => b[r] * l[0] + b[4 + r] * l[1] + b[8 + r] * l[2] + b[12 + r]);
  };
}

/**
 * How a point moves from one frame to the next: turned about the vertical
 * through where the object was by how far it turned (if `turn`), then
 * shifted with it (up and down too, if `rise`).
 * @param {{ p: number[], yaw: number }} last
 * @param {{ p: number[], yaw: number }} now
 * @returns {(point: number[]) => number[]}
 */
export function rideMove(last, now, { turn = true, rise = true } = {}) {
  const a = turn ? Math.atan2(Math.sin(now.yaw - last.yaw), Math.cos(now.yaw - last.yaw)) : 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = [now.p[0] - last.p[0], rise ? now.p[1] - last.p[1] : 0, now.p[2] - last.p[2]];
  return ([x, y, z]) => {
    const rx = x - last.p[0];
    const rz = z - last.p[2];
    // about +Y: x' = x cos + z sin, z' = −x sin + z cos (as a yaw turns +Z)
    return [last.p[0] + rx * c + rz * s + d[0], y + d[1], last.p[2] - rx * s + rz * c + d[2]];
  };
}

/**
 * The rides asked for, and the one that applies.
 * @returns {{
 *   add(id: string, opts?: { turn?: boolean, rise?: boolean, at?: number[] }, now?: number[] | null): () => void,
 *   body(spec: { id: string, turn?: boolean, rise?: boolean, at?: number[] } | null, now?: number[] | null): void,
 *   current(): object | null,
 *   step(o: { worldOf: (id: string) => number[] | null, held: boolean, position: number[], target: number[] }): { position: number[], target: number[] } | null,
 * }}
 */
export function createRides() {
  const list = []; // base rides, latest last
  let mine = null; // the current body's ride

  const make = (id, { turn = true, rise = true, tilt = false, at = null } = {}, now = null) => {
    const point = Array.isArray(at) && at.length === 3 && at.every((v) => Number.isFinite(Number(v))) ? at.map(Number) : null;
    return { id, turn: turn !== false, rise: rise !== false, tilt: tilt === true, at: point, last: now ? rideFrame(now, point) : null };
  };
  const current = () => mine ?? list.at(-1) ?? null;

  return {
    /** A base ride. `now`: the object's world matrix as the view was set from it, the ride's first baseline (else the next frame's) */
    add(id, opts, now = null) {
      const r = make(id, opts, now);
      list.push(r);
      return () => {
        const i = list.indexOf(r);
        if (i >= 0) list.splice(i, 1);
      };
    },
    /** Does the ride that applies follow roll and pitch (so the camera's up is its object's)? */
    tilts: () => !!current()?.tilt,
    /** The current body's ride (null: it has none, and the latest base ride applies) */
    body(spec, now = null) {
      mine = spec && spec.id != null ? make(spec.id, spec, now) : null;
    },
    current,
    /** One frame: where the camera and its target go now, or null to leave them. */
    step({ worldOf, held, position, target }) {
      const r = current();
      // every other ride starts again from where its object is when it next applies
      for (const x of list) if (x !== r) x.last = null;
      if (!r) return null;
      const m = worldOf(r.id);
      if (!m) {
        r.last = null;
        return null;
      }
      const now = rideFrame(m, r.at);
      const last = r.last;
      r.last = now;
      if (held || !last) return null;
      if (now.m.every((v, i) => v === last.m[i])) return null;
      if (r.tilt) {
        const move = wholeMove(last, now);
        return { position: move(position), target: move(target), up: upOf(now.m) };
      }
      if (now.yaw === last.yaw && now.p.every((v, i) => v === last.p[i])) return null;
      const move = rideMove(last, now, r);
      return { position: move(position), target: move(target) };
    },
  };
}
