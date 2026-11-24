// Card slots: the connectors on a table's pieces that take a card (or a
// tile: a slot takes whatever has one of its tags; a rack's places hold a
// domino standing on edge). Each place is the scene's connector as the stage
// gives it (content(id).extras.connectors): its position and its frame on its
// object, the whole frame where the GLB gave one (`rotation`) and else a turn
// to its yaw, read in that object's frame and never composed here. What it
// takes and how far it reaches are the scene carry's rule (scene/src/shared/carry-rules.js
// `accepts`), copied rather than imported, since packages stand alone: a
// connector that lists tags takes only objects with one of them, and it
// reaches as far as its object's `snapRadius` (scaled with the object), in plan.

/** The one tag every card has, and every card slot takes. Never a card's own name: an object's tags are public. */
export const CARD_TAGS = Object.freeze(["card"]);

/** Does a connector with these tags take an object with those? (No tags on the connector: anything.) */
export function accepts(connectorTags, objectTags) {
  if (!connectorTags?.length) return true;
  return Array.isArray(objectTags) && objectTags.some((t) => connectorTags.includes(t));
}

/**
 * An object's places, body space: { position, rotation, tags }: the scene's
 * connectors (content(id).extras.connectors), each in its frame on its object
 * (Euler XYZ): its whole frame where its GLB gave one, else a turn to its yaw
 * ([0, yaw, 0]; none: [0, 0, 0]).
 */
function placesOf(extras) {
  const finite = (v, n) => Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => Number.isFinite(Number(x)));
  return (Array.isArray(extras?.connectors) ? extras.connectors : [])
    .filter((c) => finite(c?.position, 3))
    .map((c) => {
      const yaw = c.yaw == null ? 0 : Number(c.yaw) || 0;
      return { position: c.position.slice(0, 3).map(Number), rotation: finite(c.rotation, 3) ? c.rotation.slice(0, 3).map(Number) : [0, yaw, 0], tags: c.tags };
    });
}

/**
 * An object's connectors that take something with `tags`, in the world.
 * @param {number[]} matrix  the object's world matrix (scene().world(id))
 * @param {{ connectors?: { position: number[], rotation?: number[] | null, yaw?: number | null, tags?: string[] }[], snapRadius?: number | null } | null | undefined} extras  content(id).extras
 * @param {string[]} tags
 * @returns {{ world: number[], radius: number, local: { position: number[], rotation: number[] } }[]}
 *   world: where it is (for reaching it, in plan); local: where it is on its object and its frame there
 *   (Euler XYZ), which is what a card lying in it is in that object's frame
 */
export function worldSlots(matrix, extras, tags) {
  const m = matrix;
  if (!m || !extras) return [];
  const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
  const radius = (Number(extras.snapRadius) || 0) * scale;
  if (!(radius > 0)) return [];
  const out = [];
  for (const c of placesOf(extras)) {
    // a slot for cards only, never one that takes anything: an untagged connector is a board's space
    if (!c.tags?.length || !accepts(c.tags, tags)) continue;
    const [x, y, z] = c.position;
    out.push({
      world: [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
      radius,
      local: { position: [x, y, z], rotation: c.rotation },
    });
  }
  return out;
}

/** The slot nearest a world point in plan, within its radius; null if none reaches it. */
export function nearestSlot(slots, point) {
  let best = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = Math.hypot(s.world[0] - point[0], s.world[2] - point[2]);
    if (d <= s.radius && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
