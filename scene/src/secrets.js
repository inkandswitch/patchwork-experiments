// Hidden objects: who may see what. Pure (no three.js), from the scene doc.
//
// An object with an entry in the scene's secrets doc (`scene.secretsUrl` →
// { objects: { [id]: { sourceUrl, name } } }) is drawn as itself — its public
// sourceUrl and name, a card back say — unless this viewer may see the secret:
//   - it is in a private zone (an object with `zone: { seat, min, max }`): only
//     whoever sits in that seat sees it, whichever way up it is;
//   - otherwise, it is face up (its own +Y points up in the world): everyone does.
// Anything else stays hidden. This hides the secret from the scene, not from a
// determined peer: the secrets doc is readable by anyone who opens it (see
// README, "Hidden objects").

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
