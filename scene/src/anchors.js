// Dimension anchors, as plain arrays so they can be tested without three.
// Matrices are 4×4 column-major (three.js / glTF order); the transform maths is
// in transform.js, attachment in hierarchy.js.
//
// A scene object's transform is relative to its parent (if it is attached to
// one); its GLB sits inside a group carrying the object's WORLD matrix, so
// "object-local" means the GLB's own coordinates, and an anchor on an object
// follows it — and whatever it is attached to — wherever it goes.
//
// Anchor = { objectId: string | null, local: [x,y,z] | null, world: [x,y,z] }

import { IDENTITY_TRANSFORM, applyMatrix, composeMatrix, invertMatrix, normalizeTransform, vec3 } from "./transform.js";
import { resolveParents, worldMatrix } from "./hierarchy.js";

export { IDENTITY_TRANSFORM, applyMatrix, composeMatrix, normalizeTransform } from "./transform.js";

/** Object-local → world for a transform. */
export function localToWorld(transform, local) {
  return applyMatrix(composeMatrix(transform), local);
}

/** World → object-local for a transform (uniform scale, so the inverse is cheap). */
export function worldToLocal(transform, world) {
  const t = normalizeTransform(transform);
  const m = composeMatrix({ ...t, position: [0, 0, 0], scale: 1 });
  const dx = world[0] - t.position[0];
  const dy = world[1] - t.position[1];
  const dz = world[2] - t.position[2];
  // inverse rotation = transpose
  return [
    (m[0] * dx + m[1] * dy + m[2] * dz) / t.scale,
    (m[4] * dx + m[5] * dy + m[6] * dz) / t.scale,
    (m[8] * dx + m[9] * dy + m[10] * dz) / t.scale,
  ];
}

/**
 * Where an anchor is now. If it is attached to an object that still exists and
 * has a local point, that object's current world matrix (its own transform
 * composed with every parent's) wins; otherwise the stored world point.
 * @param {object} anchor
 * @param {{ [id]: { transform, parent? } }} objects  scene.objects
 * @param {Map} [parents]  resolveParents(objects), when the caller already has it
 * @returns {{ world: [x,y,z], attached: boolean }}
 */
export function resolveAnchor(anchor, objects, parents) {
  const obj = anchor?.objectId ? objects?.[anchor.objectId] : null;
  if (obj && Array.isArray(anchor.local) && anchor.local.length === 3) {
    const m = worldMatrix(objects, anchor.objectId, parents ?? resolveParents(objects));
    return { world: applyMatrix(m, anchor.local.map(Number)), attached: true };
  }
  return { world: vec3(anchor?.world), attached: false };
}

/**
 * Build an anchor for a picked world point (optionally on an object).
 * `frame` is where the object is: a transform, or its 16-element world matrix
 * (worldMatrix(objects, objectId), which is what an attached object needs).
 */
export function makeAnchor(world, objectId = null, frame = null) {
  const w = vec3(world);
  if (!objectId) return { objectId: null, local: null, world: w };
  if (Array.isArray(frame) && frame.length === 16) {
    const inv = invertMatrix(frame);
    return { objectId, local: inv ? applyMatrix(inv, w) : w, world: w };
  }
  return { objectId, local: worldToLocal(frame ?? IDENTITY_TRANSFORM, w), world: w };
}

/** Detach an anchor from its object, freezing it at its current world position. */
export function detachAnchor(anchor, objects) {
  const { world } = resolveAnchor(anchor, objects);
  return { objectId: null, local: null, world };
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
