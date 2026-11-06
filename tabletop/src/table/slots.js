// Card slots: the connectors on a table's pieces that take a card. The rule is
// the scene hand's (scene/src/hand.js `accepts`, scene/src/parts/hand-carry.js
// `snapCandidates`), copied rather than imported, since packages stand alone:
// a connector that lists tags takes only objects with one of them, it reaches
// as far as its object's `snapRadius` (scaled with the object), in plan.

/** The one tag every card has, and every card slot takes. Never a card's own name: an object's tags are public. */
export const CARD_TAGS = Object.freeze(["card"]);

/** Does a connector with these tags take an object with those? (No tags on the connector: anything.) */
export function accepts(connectorTags, objectTags) {
  if (!connectorTags?.length) return true;
  return Array.isArray(objectTags) && objectTags.some((t) => connectorTags.includes(t));
}

/** Where a column-major matrix turns +Z, seen from above (radians about +Y). */
export const yawOfMatrix = (m) => Math.atan2(m[8], m[10]);

/**
 * An object's connectors that take something with `tags`, in the world.
 * @param {number[]} matrix  the object's world matrix (scene().world(id))
 * @param {{ connectors?: { position: number[], yaw?: number | null, tags?: string[] }[], snapRadius?: number | null } | null | undefined} extras  content(id).extras
 * @param {string[]} tags
 * @returns {{ world: number[], yaw: number | null, radius: number, local: { position: number[], yaw: number } }[]}
 */
export function worldSlots(matrix, extras, tags) {
  const m = matrix;
  if (!m || !Array.isArray(extras?.connectors)) return [];
  const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
  const radius = (Number(extras.snapRadius) || 0) * scale;
  if (!(radius > 0)) return [];
  const turn = yawOfMatrix(m);
  const out = [];
  for (const c of extras.connectors) {
    // a slot for cards only, never one that takes anything: an untagged connector is a board's space
    if (!Array.isArray(c?.position) || !c.tags?.length || !accepts(c.tags, tags)) continue;
    const [x, y, z] = c.position.map(Number);
    out.push({
      world: [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
      yaw: c.yaw == null || !Number.isFinite(Number(c.yaw)) ? null : Number(c.yaw) + turn,
      radius,
      // where it is on its object (what a card lying in it is in that object's frame)
      local: { position: [x, y, z], yaw: c.yaw == null || !Number.isFinite(Number(c.yaw)) ? 0 : Number(c.yaw) },
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
