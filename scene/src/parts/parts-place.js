// Where a part from the bin lands (scene.parts, ./parts.js), as plain arrays
// so it can be tested without three.js or a stage.
//
// A part is put at a world point: where the pointer hit, or where the view is
// looking. On an object it goes under that object (the parent) and is placed
// in that object's frame; on the ground it goes under nothing. It stands
// upright (+Y up in the world, whatever the surface's slope: a mast on a
// cambered deck stands straight), and it faces
//   - a connector's way, when it snapped to one that says (the hand's rule);
//   - else the way its parent does (the parent's +Z, seen from above), so
//     what's put on a hull lines up with the hull;
//   - else the viewer (its +Z toward the eye), as the arena's "Add target"
//     did, so a target is put down facing whoever placed it.
//
// Snapping is the hand's (./hand-carry.js snapCandidates, ../hand.js
// nearestSnap), one rule for both: a part goes to the nearest of the object's
// connectors that takes it (a tagged connector takes only a part with one of
// its tags, an open one any part) within the object's snap radius, in plan.
// An object that states no radius isn't snapped to.

import { nearestSnap } from "../hand.js";
import { composeMatrix } from "../transform.js";
import { localTransform, snapCandidates, yawOfMatrix } from "./hand-carry.js";

/** The yaw that turns a part's +Z toward the eye, seen from above (0 when the eye is straight overhead). */
export function facingEye(eye, point) {
  if (!Array.isArray(eye) || !Array.isArray(point)) return 0;
  const dx = eye[0] - point[0];
  const dz = eye[2] - point[2];
  return Math.hypot(dx, dz) < 1e-9 ? 0 : Math.atan2(dx, dz);
}

/**
 * The connector a part with these tags would go to on one object, from a
 * world point, or null: the hand's rule (snapCandidates, nearestSnap).
 * `connectors` are the content's (body space: { position, yaw?, tags? }),
 * `matrix` the object's world, `snapRadius` the content's (body units).
 * @returns {{ world: number[], yaw: number | null } | null}
 */
export function connectorFor({ matrix, connectors, snapRadius = null }, point, tags = []) {
  if (!Array.isArray(point)) return null;
  const best = nearestSnap(snapCandidates([{ id: null, matrix, connectors, snapRadius }], Array.isArray(tags) ? tags : []), point[0], point[2]);
  return best ? { world: best.world, yaw: best.yaw } : null;
}

/**
 * Where a part lands from a world point.
 * @param {{
 *   point: number[],                                   // world: where it was dropped
 *   parent?: { id: string, matrix: number[], connectors?: object[], snapRadius?: number | null } | null,
 *   tags?: string[],                                   // the part's
 *   eye?: number[] | null,                             // the camera's position (world)
 *   free?: boolean,                                    // no snapping (Alt, or the Snap pref off)
 * }} o
 * @returns {{ at: { parent: string | null, transform: object }, spot: number[], yaw: number, snapped: boolean }}
 */
export function partLanding({ point, parent = null, tags = [], eye = null, free = false }) {
  const snap = parent && !free ? connectorFor(parent, point, tags) : null;
  const spot = snap ? snap.world : point.slice(0, 3);
  const yaw = snap?.yaw ?? (parent ? yawOfMatrix(parent.matrix) : facingEye(eye, spot));
  const world = composeMatrix({ position: spot, rotation: [0, yaw, 0], scale: 1 });
  return {
    at: { parent: parent?.id ?? null, transform: localTransform(parent?.matrix ?? null, world) },
    spot,
    yaw,
    snapped: !!snap,
  };
}
