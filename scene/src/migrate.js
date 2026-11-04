// Upgrading a scene doc written in an older shape, in place, the first time a
// current scene tool opens it. Pure over the doc (run inside a change); every
// step is deterministic, so two peers upgrading at once write the same thing.
// Extensions upgrade their own old fields (README, "Extensions").

import { resolveLinks, worldMatrix } from "./hierarchy.js";
import { decomposeMatrix, invertMatrix, multiplyMatrices } from "./transform.js";

const GIZMO_TO_MODE = { translate: "move", rotate: "rotate", hand: "hand" };
const isGroup = (o) => o?.kind === "group";

/** Groups from before they were split from attachment: a group with a transform or a parent, or an object whose parent is a group. */
function hasOldGroups(objects) {
  for (const o of Object.values(objects ?? {})) {
    if (!o) continue;
    if (isGroup(o) && (o.transform !== undefined || o.parent !== undefined)) return true;
    if (!isGroup(o) && typeof o.parent === "string" && isGroup(objects[o.parent])) return true;
  }
  return false;
}

/** Is anything here in an older shape? */
export function needsCoreMigration(d) {
  return d?.view?.defaultGizmo !== undefined || hasOldGroups(d?.objects);
}

/**
 * Groups used to be parents with transforms. Now a group only organises
 * (`group`), and only an object can be a parent (`parent`). Each object goes
 * into the nearest group it was under, is attached to the nearest object it
 * was under, and keeps its world pose: what the groups between contributed is
 * baked into its own transform. A group goes into the nearest group it was
 * under, and loses its transform and parent.
 */
function splitGroups(objects) {
  const before = JSON.parse(JSON.stringify(objects));
  const old = resolveLinks(before, (id) => {
    const p = before[id]?.parent;
    return typeof p === "string" && p !== id && before[p] ? p : null;
  });
  const nearest = (id, want) => {
    for (let p = old.get(id); p != null; p = old.get(p)) if (want(before[p])) return p;
    return null;
  };
  for (const [id, o] of Object.entries(objects)) {
    if (!o) continue;
    const group = nearest(id, isGroup);
    if (isGroup(o)) {
      delete o.transform;
      delete o.parent;
      o.group = group;
      continue;
    }
    const parent = nearest(id, (x) => !isGroup(x));
    if (group != null) o.group = group;
    if (parent === (old.get(id) ?? null)) continue; // attached directly to an object (or at the root): nothing in between
    const world = worldMatrix(before, id, old);
    const inv = parent != null ? invertMatrix(worldMatrix(before, parent, old)) : null;
    const t = decomposeMatrix(parent != null && inv ? multiplyMatrices(inv, world) : world);
    o.parent = parent;
    o.transform = { position: t.position.map(tidy), rotation: t.rotation.map(tidy), scale: tidy(t.scale) };
  }
}

// rounding noise from composing and decomposing an identity is not a pose
const tidy = (v) => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));

/** Upgrade it (inside a change). */
export function migrateCore(d) {
  if (d.view && d.view.defaultGizmo !== undefined) {
    // view.defaultGizmo → view.defaultMode
    const mode = GIZMO_TO_MODE[d.view.defaultGizmo];
    if (mode && d.view.defaultMode === undefined) d.view.defaultMode = mode;
    delete d.view.defaultGizmo;
  }
  if (hasOldGroups(d.objects)) splitGroups(d.objects);
}
