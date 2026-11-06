// Riding along (STAGE.md, "Picking and camera": `camera.ride`): the orbit
// camera carried by a moving object, as a passenger is. Each frame, after
// the loops have moved what's drawn and before the orbit updates, the camera
// and its orbit target move by how the object moved since the last frame:
// the shift of a point of it (`at`, in its frame: its origin unless said;
// a seat rides the spot on the table it looks at, so that spot holds still
// on screen however she rolls), its turn about the vertical through that
// point (`turn`), and its rise and fall (`rise`). Roll and pitch are never
// followed (the orbit keeps world up).
//
// Only one ride applies at a time: the latest that isn't a `fallback`, else
// the latest fallback (a ship keeping herself in view gives way to a seat at
// a table aboard her). A ride starting to apply, or the camera held (first
// person), re-baselines it: it never moves the camera for a frame it didn't
// see. Pure: plain arrays, no three.js.

/** Where a point of an object (`at`, in its frame; its origin) is and which way it heads, from its world matrix (column-major): what a ride follows. */
export function rideFrame(m, at = null) {
  const p = at ? [0, 1, 2].map((r) => m[r] * at[0] + m[4 + r] * at[1] + m[8 + r] * at[2] + m[12 + r]) : [m[12], m[13], m[14]];
  return { p, yaw: Math.atan2(m[8], m[10]) };
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
 *   add(id: string, opts?: { turn?: boolean, rise?: boolean, fallback?: boolean, at?: number[] }, now?: number[] | null): () => void,
 *   current(): object | null,
 *   step(o: { worldOf: (id: string) => number[] | null, held: boolean, position: number[], target: number[] }): { position: number[], target: number[] } | null,
 * }}
 */
export function createRides() {
  const list = [];

  function current() {
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].fallback) return list[i];
    return list.at(-1) ?? null;
  }

  return {
    /** `now`: the object's world matrix as the view was set from it, the ride's first baseline (else the next frame's) */
    add(id, { turn = true, rise = true, fallback = false, at = null } = {}, now = null) {
      const point = Array.isArray(at) && at.length === 3 && at.every((v) => Number.isFinite(Number(v))) ? at.map(Number) : null;
      const r = { id, turn: turn !== false, rise: rise !== false, fallback: !!fallback, at: point, last: now ? rideFrame(now, point) : null };
      list.push(r);
      return () => {
        const i = list.indexOf(r);
        if (i >= 0) list.splice(i, 1);
      };
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
      if (now.yaw === last.yaw && now.p.every((v, i) => v === last.p[i])) return null;
      const move = rideMove(last, now, r);
      return { position: move(position), target: move(target) };
    },
  };
}
