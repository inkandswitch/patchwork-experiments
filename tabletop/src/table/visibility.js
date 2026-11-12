// Who may see what at a table: this package's policy, as the stage's
// `audience` contribution (scene/STAGE.md, "Audience"). Pure, over a scene
// snapshot (api.scene(): { objects, world(id), toLocal(id, point), parents })
// and who sits where (the `roster` convention's seats: [{ id, viewer }]).
//
// Two physical things, and nothing about any game:
//
//   - a HAND (an object with trait tabletop.zone: { seat, min, max }, a box
//     in that object's own frame): whatever lies in it (its origin does) is
//     turned toward whoever sits in that seat and screened from everyone
//     else, whichever way up it is:  { show: [player], only: [player] }.
//     A hand nobody sits at shows to nobody:  { show: [], only: [] }.
//   - a CARD (trait tabletop.card): two-sided. Lying face up outside every
//     hand, it shows to everyone:  { show: "all" }. Face down it shows to
//     nobody (no answer).
//
// So another seat's hand is never turned toward you: a keeper shows you its
// cards' own backs there (which back it is, is real information when a table
// has several decks), and its veil only for something face up that isn't
// yours to see. The policy says who; what is then drawn is the keeper's.
//
// It reads the doc alone: never poses, presence or claims, so every peer
// answers alike and nothing flickers as a ship carrying the table moves.

export const ZONE = "tabletop.zone";
export const CARD = "tabletop.card";

/** Is this object a card: two-sided, shuffled and drawn in piles? */
export const isCard = (o) => !!o?.traits && typeof o.traits === "object" && Object.hasOwn(o.traits, CARD) && o.traits[CARD] != null;

/** Every well-formed hand: { id, seat, min, max }. */
export function zones(scene) {
  const out = [];
  for (const [id, o] of Object.entries(scene?.objects ?? {})) {
    const z = o?.traits?.[ZONE];
    if (!z || typeof z.seat !== "string" || !Array.isArray(z.min) || !Array.isArray(z.max)) continue;
    out.push({ id, seat: z.seat, min: z.min.map(Number), max: z.max.map(Number) });
  }
  return out;
}

/** The seat whose hand holds this world point, or null. */
export function seatAt(scene, regions, world) {
  for (const r of regions) {
    const p = scene.toLocal(r.id, world);
    if (p && p.every((v, k) => v >= r.min[k] && v <= r.max[k])) return r.seat;
  }
  return null;
}

/** The object an object is attached to (the snapshot's `parents`, else its doc `parent` if that's there), or null. */
export function parentOf(scene, id) {
  if (scene?.parents?.get) return scene.parents.get(id) ?? null;
  const p = scene?.objects?.[id]?.parent;
  return typeof p === "string" && p !== id && scene.objects[p] ? p : null;
}

/**
 * Is it face up: does its own +Y point the way the up of the frame it lies
 * in does (its parent's +Y; the world's at the root)? Judged in that frame,
 * not against the world's up, so a card on a table aboard a ship that heels,
 * rolls or is upside down in a capsize is face up or down as it lies on the
 * table, and from the doc (scene.world), not the pose drawn this frame, so
 * every peer agrees and nothing flickers as she moves. At the root it is
 * the world's up. Pure.
 */
export function faceUpIn(scene, id) {
  const m = scene.world(id);
  const p = parentOf(scene, id);
  const up = p ? scene.world(p) : null;
  // column-major: the Y axis is m[4..6]
  const y = [m[4], m[5], m[6]];
  const u = up ? [up[4], up[5], up[6]] : [0, 1, 0];
  const dot = y[0] * u[0] + y[1] * u[1] + y[2] * u[2];
  return dot / ((Math.hypot(...y) || 1) * (Math.hypot(...u) || 1)) > 1e-6;
}

/** The seat a viewer sits in, by the roster's seats ([{ id, viewer }]): the first that names them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  return (seats ?? []).find((s) => s?.viewer === viewer)?.id ?? null;
}

/**
 * The table's policy for a snapshot: object id → { show?, only? } | null
 * (the stage's `audience` answer). `seats` is who sits where, from the
 * roster ([{ id, viewer | null }]); a hand whose seat isn't among them is
 * nobody's.
 * @param {object} scene  the snapshot
 * @param {{ id: string, viewer: string | null }[]} seats
 * @returns {(id: string) => { show?: "all" | string[], only?: string[] } | null}
 */
export function audienceOf(scene, seats) {
  const regions = zones(scene);
  const player = new Map((seats ?? []).map((s) => [s.id, typeof s.viewer === "string" && s.viewer ? s.viewer : null]));
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const o = scene?.objects?.[id];
    let answer = null;
    if (o) {
      const m = scene.world(id);
      const seat = regions.length ? seatAt(scene, regions, [m[12], m[13], m[14]]) : null;
      if (seat != null) {
        const p = player.get(seat) ?? null;
        answer = p ? { show: [p], only: [p] } : { show: [], only: [] };
      } else if (isCard(o) && faceUpIn(scene, id)) answer = { show: "all" };
    }
    cache.set(id, answer);
    return answer;
  };
}

/** The roster's seats for a snapshot, from whoever contributes one (api.collect("roster")): [{ id, name, viewer }], [] with none. */
export function seatsFrom(api, scene) {
  for (const r of api.collect?.("roster") ?? []) {
    if (typeof r?.value?.seats !== "function") continue;
    try {
      const list = r.value.seats(scene);
      if (Array.isArray(list)) return list;
    } catch (err) {
      console.warn("[tabletop] the roster failed", err);
    }
  }
  return [];
}
