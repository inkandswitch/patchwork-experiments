// Hidden objects: who may see what. Pure (no three.js), from the scene doc.
//
// A hidden object is drawn as itself — its public sourceUrl and name, a card
// back say — unless this viewer may see what it really is:
//   - it is in a private zone (an object with `zone: { seat, min, max }`): only
//     whoever sits in that seat sees it, whichever way up it is;
//   - otherwise, it is face up (its own +Y points up in the world): everyone does.
// Anything else stays hidden. What a hidden object really is comes from the
// scene's secrets doc (`scene.secretsUrl`), through a resolver: the built-in
// one reads a plain `scene-secrets` doc ({ objects: { [id]: { sourceUrl, name } } },
// readable by anyone who opens it); a `scene:secrets` plugin can supply one
// for another kind of doc, such as an encrypted deck (see README, "Hidden
// objects").

import { applyMatrix, invertMatrix } from "./transform.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";

/** Every private zone in the scene: its seat, and its box in its own frame with the inverse world matrix to get there. */
export function zoneRegions(objects, parents = resolveParents(objects)) {
  const out = [];
  for (const [id, o] of Object.entries(objects ?? {})) {
    const z = o?.zone;
    if (!z || typeof z.seat !== "string" || !Array.isArray(z.min) || !Array.isArray(z.max)) continue;
    const inv = invertMatrix(worldMatrix(objects, id, parents));
    if (!inv) continue;
    out.push({ id, seat: z.seat, inv, min: z.min.map(Number), max: z.max.map(Number) });
  }
  return out;
}

/** The seat whose zone holds this world point, or null. */
export function seatAt(regions, world) {
  for (const r of regions) {
    const p = applyMatrix(r.inv, world);
    if (p.every((v, k) => v >= r.min[k] && v <= r.max[k])) return r.seat;
  }
  return null;
}

/** Does the object's own +Y point up in the world? */
export function isFaceUp(objects, id, parents = resolveParents(objects)) {
  // column-major: the Y axis's world y component
  return worldMatrix(objects, id, parents)[5] > 1e-6;
}

/**
 * Who may see what, for this snapshot of the scene: a function of a player
 * (their contact / viewer id; null for "everyone") to the set of object ids
 * they may see as themselves. A player sees what's in their seat's zone and
 * what's face up outside every zone; everyone sees only the latter. Cached
 * per player for the snapshot.
 */
export function visibility(objects, seats) {
  const parents = resolveParents(objects ?? {});
  const regions = zoneRegions(objects, parents);
  const where = new Map(); // id → { owner, faceUp }
  for (const id of Object.keys(objects ?? {})) {
    const m = worldMatrix(objects, id, parents);
    where.set(id, { owner: seatAt(regions, [m[12], m[13], m[14]]), faceUp: m[5] > 1e-6 });
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

/** The players in the scene's seats, in seat order. */
export function seatedPlayers(seats) {
  return Object.values(seats ?? {}).map((s) => s?.player).filter((p) => typeof p === "string" && p);
}

/**
 * The built-in resolver, for a plain `scene-secrets` doc: whatever this viewer
 * may see, looked up. (A resolver: update(ctx) on every scene change, looks()
 * → Map id → { sourceUrl, name }, status() → string | null, dispose().)
 */
export function plainResolver({ handle, viewer, onChange }) {
  let ctx = null;
  let current = new Map();
  const compute = () => {
    const secrets = handle.doc()?.objects ?? {};
    const next = new Map();
    if (ctx) for (const id of ctx.visibleTo(viewer)) if (secrets[id]?.sourceUrl) next.set(id, secrets[id]);
    const same = next.size === current.size && [...next].every(([id, s]) => current.get(id)?.sourceUrl === s.sourceUrl && current.get(id)?.name === s.name);
    current = next;
    return !same;
  };
  const onDoc = () => compute() && onChange?.();
  handle.on?.("change", onDoc);
  return {
    update(c) {
      ctx = c;
      compute();
    },
    looks: () => current,
    status: () => null,
    dispose: () => handle.off?.("change", onDoc),
  };
}

/**
 * Which hidden objects this viewer may see, as id → its secret ({ sourceUrl, name }).
 * @param {object} objects    the scene's objects
 * @param {object} secrets    the secrets doc's `objects`
 * @param {string | null} seat the seat the viewer sits in (null: watching)
 */
export function revealedSecrets(objects, secrets, seat) {
  const out = new Map();
  if (!objects || !secrets) return out;
  const parents = resolveParents(objects);
  const regions = zoneRegions(objects, parents);
  for (const [id, secret] of Object.entries(secrets)) {
    if (!objects[id] || !secret || typeof secret.sourceUrl !== "string") continue;
    const m = worldMatrix(objects, id, parents);
    const owner = seatAt(regions, [m[12], m[13], m[14]]);
    if (owner ? owner === seat : isFaceUp(objects, id, parents)) out.set(id, secret);
  }
  return out;
}

/** The seat this viewer sits in: the first whose `player` is them. */
export function seatOf(seats, viewer) {
  if (!viewer) return null;
  for (const [id, s] of Object.entries(seats ?? {})) if (s?.player === viewer) return id;
  return null;
}
