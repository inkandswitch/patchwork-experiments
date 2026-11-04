// Who may see what at a table. Pure, over a scene snapshot (the scene's
// extension api.scene(): { objects, world(id), toLocal(id, point), traits }).
//
// A hidden object (trait tabletop.hidden: { by: <deck url> }) is drawn as
// itself — its public look, a card back say — unless this viewer may see what
// it really is:
//   - it is in a private zone (an object with trait tabletop.zone: { seat,
//     min, max }, a box in that object's own frame): only whoever sits in
//     that seat sees it, whichever way up it is;
//   - otherwise, it is face up (its own +Y points up in the world): everyone does.
// Anything else stays hidden. The seats are the scene's trait tabletop.seats:
// { [seatId]: { name, player, camera? } }.

export const ZONE = "tabletop.zone";
export const HIDDEN = "tabletop.hidden";
export const SEATS = "tabletop.seats";

const ID = /automerge:([1-9A-HJ-NP-Za-km-z]{20,60})/;

/** An automerge URL without heads or anything else, else null. */
export function docUrl(v) {
  const m = typeof v === "string" ? ID.exec(v) : null;
  return m ? `automerge:${m[1]}` : null;
}

/** The deck an object belongs to (its url), or null if it isn't hidden. */
export const hiddenBy = (o) => docUrl(o?.traits?.[HIDDEN]?.by);

/** The scene's seats. */
export const seatsOf = (scene) => scene?.traits?.[SEATS] ?? {};

/** Every well-formed private zone: { id, seat, min, max }. */
export function zones(scene) {
  const out = [];
  for (const [id, o] of Object.entries(scene?.objects ?? {})) {
    const z = o?.traits?.[ZONE];
    if (!z || typeof z.seat !== "string" || !Array.isArray(z.min) || !Array.isArray(z.max)) continue;
    out.push({ id, seat: z.seat, min: z.min.map(Number), max: z.max.map(Number) });
  }
  return out;
}

/** The seat whose zone holds this world point, or null. */
export function seatAt(scene, regions, world) {
  for (const r of regions) {
    const p = scene.toLocal(r.id, world);
    if (p && p.every((v, k) => v >= r.min[k] && v <= r.max[k])) return r.seat;
  }
  return null;
}

/** Does the object's own +Y point up in the world? */
export function isFaceUp(scene, id) {
  // column-major: the Y axis's world y component
  return scene.world(id)[5] > 1e-6;
}

/** The seat this viewer sits in: the first whose `player` is them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  for (const [id, s] of Object.entries(seats ?? {})) if (s?.player === viewer) return id;
  return null;
}

/** The players in the seats, in seat order. */
export function seatedPlayers(seats) {
  return Object.values(seats ?? {}).map((s) => s?.player).filter((p) => typeof p === "string" && p);
}

/**
 * Who may see what, for this snapshot: a function of a player (their contact
 * / viewer id; null for "everyone") to the set of object ids they may see as
 * themselves. Cached per player for the snapshot.
 */
export function visibility(scene, seats = seatsOf(scene)) {
  const regions = zones(scene);
  const where = new Map(); // id → { owner, faceUp }
  for (const id of Object.keys(scene?.objects ?? {})) {
    const m = scene.world(id);
    where.set(id, { owner: seatAt(scene, regions, [m[12], m[13], m[14]]), faceUp: m[5] > 1e-6 });
  }
  const cache = new Map();
  return (player) => {
    const seat = player == null ? null : seatOf(seats, player);
    const key = seat ?? "";
    if (!cache.has(key)) {
      const out = new Set();
      for (const [id, w] of where) if (w.owner ? w.owner === seat : w.faceUp) out.add(id);
      cache.set(key, out);
    }
    return cache.get(key);
  };
}
