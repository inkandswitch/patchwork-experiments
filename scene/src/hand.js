// The hand: picking an object up and setting it down somewhere else on the
// table, the way a piece is moved in a board game. Pure (no three.js), so it
// can be tested; the viewport supplies the points and the ray hits.
//
// - Connectors come from GLBs (`extras.connectors`, and the older
//   `extras.snapPoints`; see README). A dropped object's footprint centre goes
//   to the nearest one within its radius that accepts it (its tags), in plan
//   (x, z) only: height is decided by what is underneath.
// - Resting: the object is lowered until its box sits on the highest surface
//   under its footprint (a few rays straight down), or on the ground. No
//   physics: nothing tips, slides or bounces, and only the final pose is
//   written to the doc.

/**
 * The yaw (radians about +Y) a rotation turns +Z to, seen from above: where
 * something set down facing that way faces. Euler XYZ radians (R = Rx·Ry·Rz).
 * null if it turns +Z straight up or down.
 */
export function yawOfEuler(rotation) {
  const [x, y] = rotation.map(Number);
  const fx = Math.sin(y);
  const fz = Math.cos(x) * Math.cos(y);
  return Math.hypot(fx, fz) < 1e-9 ? null : Math.atan2(fx, fz);
}

/**
 * Clean connectors from a GLB: `extras.connectors`, a list of
 * { position: [x, y, z], rotation?: [x, y, z] (Euler XYZ radians), tags?:
 * string[] }, or the older `extras.snapPoints`, a list of [x, y, z] or
 * { position, yaw? }. The rotation is the connector's frame; the hand uses
 * its yaw (where it turns +Z, seen from above) to turn whatever is set down
 * there to face that way — a card in the far player's column reads the right
 * way up for them. A connector with tags takes only objects with one of them
 * (none: anything). Anything malformed is dropped.
 * @returns {{ position: number[], yaw: number | null, tags: string[] }[]}
 */
export function sanitizeConnectors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    const v = Array.isArray(p) ? p : Array.isArray(p?.position) ? p.position : null;
    if (!v || v.length < 3) continue;
    const xyz = [Number(v[0]), Number(v[1]), Number(v[2])];
    if (!xyz.every(Number.isFinite)) continue;
    const rot = !Array.isArray(p) && Array.isArray(p?.rotation) && p.rotation.length >= 3 && p.rotation.slice(0, 3).every((r) => Number.isFinite(Number(r))) ? p.rotation : null;
    const yaw = rot ? yawOfEuler(rot) : Array.isArray(p) || p.yaw == null ? null : Number(p.yaw);
    const tags = !Array.isArray(p) && Array.isArray(p?.tags) ? p.tags.filter((t) => typeof t === "string" && t) : [];
    out.push({ position: xyz, yaw: Number.isFinite(yaw) ? yaw : null, tags });
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
