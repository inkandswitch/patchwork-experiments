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
//     nobody (no answer). Standing on edge outside every hand (a domino stood
//     up on the table in front of you, as one is played without a rack), it
//     shows to the seat whose hand its face looks toward, and is screened
//     from the rest, as if it were in that hand:  { show: [player], only:
//     [player] } (`facing`). One facing no hand is judged as lying.
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

/** A point under a 4 × 4 column-major matrix. */
const at = (m, p) => [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
/** The part of `v` square to the unit `u` (level, when `u` is up). */
const flat = (v, u) => {
  const d = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  return [v[0] - d * u[0], v[1] - d * u[1], v[2] - d * u[2]];
};
const unit = (v) => {
  const l = Math.hypot(...v);
  return l > 1e-9 ? v.map((x) => x / l) : null;
};

/**
 * Is it standing on an edge or an end: its own +Y (its face) nearer level
 * than up or down in the frame it lies in (more than 45° from either)? The
 * same test as Stand on edge's (stand.js isStanding), judged in the frame as
 * faceUpIn is. Pure.
 */
export function standingIn(scene, id) {
  const m = scene.world(id);
  const p = parentOf(scene, id);
  const up = p ? unit(scene.world(p).slice(4, 7)) : [0, 1, 0];
  const y = unit([m[4], m[5], m[6]]);
  if (!y || !up) return false;
  return Math.abs(y[0] * up[0] + y[1] * up[1] + y[2] * up[2]) < Math.SQRT1_2;
}

/**
 * The hand a standing thing's face looks toward: of every hand, the one the
 * level direction from it to the middle of that hand's box is nearest the
 * level direction of its face, within 45° (so at most one; a tie goes to the
 * nearer hand, then the lower seat id, then the lower hand id, so every peer
 * answers alike). Level is square to the up of the frame it lies in. null
 * when it isn't standing (standingIn), or no hand is within 45° of where it
 * looks. Pure, from the doc.
 * @returns {{ id: string, seat: string } | null}
 */
export function facing(scene, regions, id) {
  if (!standingIn(scene, id)) return null;
  const m = scene.world(id);
  const p = parentOf(scene, id);
  const up = p ? unit(scene.world(p).slice(4, 7)) : [0, 1, 0];
  const face = unit(flat([m[4], m[5], m[6]], up));
  if (!face) return null;
  const here = [m[12], m[13], m[14]];
  let best = null;
  for (const r of regions) {
    const c = at(scene.world(r.id), [0, 1, 2].map((k) => (r.min[k] + r.max[k]) / 2));
    const to = flat([c[0] - here[0], c[1] - here[1], c[2] - here[2]], up);
    const dist = Math.hypot(...to);
    const d = unit(to);
    if (!d) continue;
    const cos = d[0] * face[0] + d[1] * face[1] + d[2] * face[2];
    if (cos < Math.SQRT1_2) continue;
    const better =
      !best ||
      cos > best.cos + 1e-9 ||
      (Math.abs(cos - best.cos) <= 1e-9 && (dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && (r.seat < best.seat || (r.seat === best.seat && r.id < best.id)))));
    if (better) best = { id: r.id, seat: r.seat, cos, dist };
  }
  return best ? { id: best.id, seat: best.seat } : null;
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
      // in a hand; else a card standing, facing one
      const seat = regions.length ? (seatAt(scene, regions, [m[12], m[13], m[14]]) ?? (isCard(o) ? (facing(scene, regions, id)?.seat ?? null) : null)) : null;
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
