// The structural doc verbs, as pure planners: remove, ungroup, new group, file
// in a group, attach, move a row, and the plain field and transform writes.
//
// Each planner reads a doc snapshot (api.doc(), or the stage's api.scene(),
// whose `.d` it uses), works out everything from that, and returns one of:
//
//   - null: nothing to write. The ids it names aren't there, or the move
//     wouldn't change anything (a row released where it already sits).
//   - a plan: a change function `(draft) => void` for api.change, with
//     `plan.ok === true` and whatever a surface wants to know beforehand as
//     fields on it (`plan.ids` a removal takes, `plan.id` of a new group, …).
//   - a refusal: a change function that writes nothing, with
//     `plan.ok === false` and `plan.reason`, a sentence to show. It is a
//     function so `api.change(ops.x(...))` is always safe; a surface that
//     wants to say why checks `plan.ok` first.
//
// So a caller reads:
//
//   const plan = ops.fileIn(api.doc(), id, group);
//   if (plan && !plan.ok) api.notify(plan.reason, "error");
//   else if (plan) api.change(plan);
//
// Planners never select, expand, toast or confirm: that's for whoever called.
// The change function re-checks that each object is still in the draft, since
// a peer may have removed it between the snapshot and the change.
//
// Plans are planned on the RESOLVED trees (hierarchy.js resolveParents,
// groups.js resolveGroups), which break a merged cycle at its smallest id.
// The losing edge is still written in the doc, and comes back (moving an
// object nobody touched) once some later write makes it acyclic. So every
// structural plan clears those edges first (repairCycles), and the doc then
// says the trees everyone already sees.

import { brokenParents, orphanTransforms, planAttach, resolveParents } from "./hierarchy.js";
import { brokenGroups, groupChain, isGroup, outlineParents, removalSet, resolveGroups, ungroupPlan } from "./groups.js";
import { isMove, spliceOrder } from "./tree-drop.js";
import { normalizeTransform } from "./transform.js";

export const REASONS = Object.freeze({
  groupInItself: "A group can't go inside itself.",
  groupOnlyInGroup: "A group can only go inside another group.",
  notAGroup: "That isn't a group.",
  attachLoop: "Can't attach an object to something attached to it.",
  attachGroup: "A group isn't attached to anything.",
  attachToGroup: "An object can only be attached to another object.",
  idTaken: "That id is already in use.",
  structural: "Use attachTo or fileIn to change what an object is attached to or filed in.",
});

// ─── plan shapes ─────────────────────────────────────────────────────────────

/**
 * A plan: `apply` with `info` as fields on it, and `ok: true`. Avoid info keys
 * a function already owns (`name`, `length`): they're read-only.
 */
export function planned(apply, info = {}) {
  return Object.assign(apply, info, { ok: true });
}

/** A refusal: a change function that writes nothing, with the reason to show. */
export function refused(reason) {
  const plan = () => {};
  plan.ok = false;
  plan.reason = reason;
  return plan;
}

// ─── reading the snapshot ────────────────────────────────────────────────────

/** The doc behind a snapshot: api.doc() itself, or api.scene()'s `.d`. */
export function docOf(snapshot) {
  const s = snapshot ?? {};
  return s.d && typeof s.d === "object" && s.parents instanceof Map ? s.d : s;
}

/**
 * Every object id, in the doc's `order` first (skipping missing and repeated
 * ids), then any the order doesn't list, in key order. What the outline shows.
 */
export function orderedIds(snapshot) {
  const doc = docOf(snapshot);
  const objects = doc?.objects ?? {};
  const seen = new Set();
  const out = [];
  for (const id of doc?.order ?? []) if (objects[id] && !seen.has(id)) seen.add(id), out.push(id);
  for (const id of Object.keys(objects)) if (!seen.has(id)) out.push(id);
  return out;
}

function read(snapshot) {
  const doc = docOf(snapshot);
  const objects = doc?.objects ?? {};
  const parents = resolveParents(objects);
  const groups = resolveGroups(objects);
  return { doc, objects, parents, groups };
}

// A transform as fresh plain arrays: automerge refuses a value that is
// already inside a document, and a snapshot's arrays may be.
const fresh = (t) => {
  const n = normalizeTransform(t);
  return { position: [...n.position], rotation: [...n.rotation], scale: n.scale };
};

const asList = (ids) => (ids == null ? [] : typeof ids === "string" ? [ids] : [...ids]);

// ─── change-time helpers ─────────────────────────────────────────────────────

/**
 * Inside a change: clear the parent and group edges a merged cycle left
 * behind (see brokenParents, brokenGroups), so the trees the doc says are
 * the trees everyone sees. Each one's transform is already its world pose.
 */
export function repairCycles(d, broken = [], brokenG = []) {
  for (const bid of broken) {
    const o = d.objects?.[bid];
    if (o) o.parent = null;
  }
  for (const bid of brokenG) {
    const o = d.objects?.[bid];
    if (o) o.group = null;
  }
}

/** Inside a change: take every id in `gone` out of the doc's `order`, in place. */
export function removeFromOrder(d, gone) {
  if (!d.order) return;
  for (let i = d.order.length - 1; i >= 0; i--) if (gone.has(d.order[i])) d.order.splice(i, 1);
}

// ─── remove ──────────────────────────────────────────────────────────────────

/**
 * Remove objects and groups. A group goes with everything below it in the
 * outline; anything attached to what goes (and not going itself) stays where
 * it is in the world, now at the scene root.
 *
 * The doc's dimensions aren't touched here: an anchor on a removed object is
 * the dimensions extension's to detach, in its beforeRemove(draft, plan.ids),
 * which api.remove runs in the same change.
 *
 * @param {object} snapshot
 * @param {string | string[]} ids
 * @returns plan with `ids` (everything removed: the named ones first) and
 *   `within` (those removed only because a group they're in is: what a
 *   confirm counts), or null when none of `ids` is there
 */
export function removeObjects(snapshot, ids) {
  const { objects, parents, groups } = read(snapshot);
  const asked = [...new Set(asList(ids))].filter((id) => objects[id]);
  if (!asked.length) return null;
  const outline = outlineParents(objects, parents, groups);
  const gone = new Set(asked);
  for (const id of asked) for (const x of removalSet(objects, id, outline)) gone.add(x);
  const orphans = {};
  for (const g of gone) for (const [c, t] of Object.entries(orphanTransforms(objects, g, parents))) if (!gone.has(c)) orphans[c] = t;
  const broken = brokenParents(objects, parents);
  const brokenG = brokenGroups(objects, groups);
  const all = [...gone];
  return planned(
    (d) => {
      repairCycles(d, broken, brokenG);
      for (const [child, transform] of Object.entries(orphans)) {
        const o = d.objects?.[child];
        if (!o) continue;
        o.parent = null;
        o.transform = fresh(transform);
      }
      if (d.objects) for (const g of gone) delete d.objects[g];
      removeFromOrder(d, gone);
    },
    { ids: all, within: all.filter((id) => !asked.includes(id)), orphans: Object.keys(orphans) },
  );
}

// ─── groups ──────────────────────────────────────────────────────────────────

/**
 * Ungroup: what's in the group moves up to the group it's in, looking as it
 * did (groups.js ungroupPlan folds the group's visibility and opacity into
 * each member); the group goes. Nothing moves: a group has no transform.
 * @returns plan with `id`, `members` and `into` (the group they move to, or
 *   null), or null when `id` isn't a group
 */
export function ungroup(snapshot, id) {
  const { objects, groups } = read(snapshot);
  if (!isGroup(objects[id])) return null;
  const plan = ungroupPlan(objects, id, groups);
  const brokenG = brokenGroups(objects, groups);
  return planned(
    (d) => {
      repairCycles(d, [], brokenG);
      for (const child of plan.members) {
        const o = d.objects?.[child];
        if (!o) continue;
        o.group = plan.group;
        const look = plan.display[child];
        if (look?.visible === false) o.visible = false;
        if (look?.opacity !== undefined) o.opacity = look.opacity;
      }
      if (d.objects) delete d.objects[id];
      removeFromOrder(d, new Set([id]));
    },
    { id, members: plan.members, into: plan.group },
  );
}

/** A fresh group id, the way the tool makes ids. */
export const newGroupId = () => `g${Math.random().toString(36).slice(2, 10)}`;

/**
 * A new, empty group: inside `into` (a group id), or — with `around` — where
 * that object (or group) is filed and just in front of it in the order, and
 * `around` goes into it. Nothing moves. An `into` that isn't a group, or an
 * `around` that isn't there, is ignored, and the group goes at the top level.
 *
 * @param {object} snapshot
 * @param {{ into?: string | null, around?: string | null, id?: string, name?: string }} [o]
 *   `id` defaults to a fresh one; `name` is the group's ("Group")
 * @returns plan with `id` (the new group), `group` (the group it's in) and
 *   `around`; a refusal when `id` is already taken
 */
export function newGroup(snapshot, { into = null, around = null, id = newGroupId(), name = "Group" } = {}) {
  const { objects, groups } = read(snapshot);
  if (objects[id]) return refused(REASONS.idTaken);
  const wrap = around && objects[around] ? around : null;
  const inGroup = wrap ? groups.get(wrap) ?? null : into && isGroup(objects[into]) ? into : null;
  const brokenG = brokenGroups(objects, groups);
  return planned(
    (d) => {
      repairCycles(d, [], brokenG);
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      d.objects[id] = { kind: "group", name, group: inGroup, visible: true, opacity: 1 };
      const at = wrap ? d.order.indexOf(wrap) : -1;
      if (at >= 0) d.order.splice(at, 0, id);
      else d.order.push(id);
      if (wrap && d.objects[wrap]) d.objects[wrap].group = id;
    },
    { id, group: inGroup, around: wrap },
  );
}

/**
 * File `id` (an object or a group) in `group` (null = none). Nothing moves:
 * filing is organisation, not attachment.
 * @returns plan with `id` and `group`; a refusal when `group` isn't a group,
 *   or is `id` or inside it; null when `id` isn't there or is already filed
 *   there
 */
export function fileIn(snapshot, id, group) {
  const { objects, groups } = read(snapshot);
  if (!objects[id]) return null;
  const target = group ?? null;
  if (target != null) {
    if (!isGroup(objects[target])) return refused(REASONS.notAGroup);
    if (target === id || groupChain(groups, target).includes(id)) return refused(REASONS.groupInItself);
  }
  const brokenG = brokenGroups(objects, groups);
  if ((objects[id].group ?? null) === target && !brokenG.length) return null;
  return planned(
    (d) => {
      repairCycles(d, [], brokenG);
      const o = d.objects?.[id];
      if (o) o.group = target;
    },
    { id, group: target },
  );
}

// ─── attachment ──────────────────────────────────────────────────────────────

/**
 * Attach `id` to `parent` (null, or an object that isn't there, detaches),
 * keeping it where it is in the world: hierarchy.js planAttach says what its
 * local transform becomes.
 * @returns plan with `id`, `parent` and `transform` (the new local one); a
 *   refusal when that would make a loop, or either end is a group; null when
 *   `id` isn't there or is already attached there
 */
export function attachTo(snapshot, id, parent) {
  const { objects, parents } = read(snapshot);
  const o = objects[id];
  if (!o) return null;
  if (isGroup(o)) return refused(REASONS.attachGroup);
  if (parent != null && isGroup(objects[parent])) return refused(REASONS.attachToGroup);
  const plan = planAttach(objects, id, parent ?? null, parents);
  if (!plan) return refused(REASONS.attachLoop);
  const broken = brokenParents(objects, parents);
  if ((o.parent ?? null) === plan.parent && !broken.length) return null;
  return planned(
    (d) => {
      repairCycles(d, broken);
      const x = d.objects?.[id];
      if (!x) return;
      x.parent = plan.parent;
      x.transform = fresh(plan.transform);
    },
    { id, parent: plan.parent, transform: plan.transform },
  );
}

// ─── the outline's row moves ─────────────────────────────────────────────────

/**
 * Move `id` to where a drop in the outline asked for (`place`, from
 * tree-drop.js placementFor), keeping its world pose. The rows it's dropped
 * among say both things the outline shows: a group's rows file it in that
 * group (and detach it), an object's attach it to that object (in that
 * object's group). A group goes only into another group.
 *
 * A reorder within the same place leaves parent and transform alone, so it
 * can't win last-writer-wins over a peer's gizmo move; only `order` changes,
 * spliced so a peer's concurrent insert survives.
 *
 * @param {object} snapshot
 * @param {string} id
 * @param {{ parent: string | null, before: string | null }} place
 * @param {string[]} [order]  the flat order the place was worked out in (default: orderedIds)
 * @returns plan with `id`, `parent` (the row it went under, or null) and
 *   `group`; a refusal for a group among an object's attachments, a group
 *   into itself, or an attachment loop; null when nothing would change (a row
 *   released where it sits, or onto itself)
 */
export function moveRow(snapshot, id, place, order = orderedIds(snapshot)) {
  const { objects, parents, groups } = read(snapshot);
  if (!objects[id]) return null;
  const outline = outlineParents(objects, parents, groups);
  const target = place?.parent && objects[place.parent] ? place.parent : null;
  // A row released on itself, or on the line it already sits at, is a
  // click that wobbled: nothing to write.
  if (target === id) return null;
  if (!isMove(objects, order, id, { parent: target, before: place?.before ?? null }, outline)) return null;
  const toGroup = !target || isGroup(objects[target]);
  const group = toGroup ? target : groups.get(target) ?? null;
  let plan = null;
  if (isGroup(objects[id])) {
    if (!toGroup) return refused(REASONS.groupOnlyInGroup);
    if (target && groupChain(groups, target).includes(id)) return refused(REASONS.groupInItself);
  } else {
    plan = planAttach(objects, id, toGroup ? null : target, parents);
    if (!plan) return refused(REASONS.attachLoop);
  }
  const reparent = !!plan && plan.parent !== (parents.get(id) ?? null);
  const regroup = (groups.get(id) ?? null) !== group;
  const broken = brokenParents(objects, parents);
  const brokenG = brokenGroups(objects, groups);
  const before = place?.before ?? null;
  return planned(
    (d) => {
      repairCycles(d, broken, brokenG);
      const o = d.objects?.[id];
      if (!o) return;
      if (reparent) {
        o.parent = plan.parent;
        o.transform = fresh(plan.transform);
      }
      if (regroup) o.group = group;
      if (!d.order) d.order = [];
      spliceOrder(d.order, id, before);
    },
    { id, parent: target, group },
  );
}

// ─── plain writes ────────────────────────────────────────────────────────────

const STRUCTURAL = new Set(["parent", "group", "kind"]);

/**
 * Set one field of an object (name, visible, opacity, color, wireframe,
 * locked, …). Only that field: never the object's whole map. `undefined`
 * deletes the field (automerge can't hold undefined). `parent`, `group` and
 * `kind` are refused: attachTo and fileIn keep the trees and poses right.
 * @returns plan with `id`, `key` and `value`; null when `id` isn't there or
 *   the field already holds that (primitive) value
 */
export function setField(snapshot, id, key, value) {
  const { objects } = read(snapshot);
  const o = objects[id];
  if (!o) return null;
  if (STRUCTURAL.has(key)) return refused(REASONS.structural);
  if (value === undefined ? !(key in o) : Object.is(o[key], value)) return null;
  return planned(
    (d) => {
      const x = d.objects?.[id];
      if (!x) return;
      if (value === undefined) delete x[key];
      else x[key] = value;
    },
    { id, key, value },
  );
}

/**
 * Write whole local transforms: one (`id`, `transform`), or several at once as
 * a Map, an object or entries of id → transform (a group moved with the
 * gizmo). Each is normalised and written fresh. Ids that aren't there are
 * skipped.
 * @returns plan with `ids` (those written), or null when none is there
 */
export function setTransform(snapshot, idOrMoved, transform) {
  const { objects } = read(snapshot);
  const entries =
    typeof idOrMoved === "string"
      ? [[idOrMoved, transform]]
      : idOrMoved instanceof Map || Array.isArray(idOrMoved)
        ? [...idOrMoved]
        : Object.entries(idOrMoved ?? {});
  const moved = entries.filter(([id]) => objects[id] && !isGroup(objects[id])).map(([id, t]) => [id, fresh(t)]);
  if (!moved.length) return null;
  return planned(
    (d) => {
      for (const [id, t] of moved) {
        const o = d.objects?.[id];
        if (o) o.transform = { position: [...t.position], rotation: [...t.rotation], scale: t.scale };
      }
    },
    { ids: moved.map(([id]) => id) },
  );
}

/**
 * Write one number of an object's transform — `position[i]`, `rotation[i]`
 * (radians) or `scale` — and nothing else, so two people typing X and Y at
 * once both land. A scale that isn't above zero becomes 1. Units are the
 * caller's to convert.
 * @param {"position" | "rotation" | "scale"} kind
 * @returns plan with `id`, or null when `id` isn't there (or is a group) or
 *   the value isn't a finite number
 */
export function setTransformPart(snapshot, id, kind, index, value) {
  const { objects } = read(snapshot);
  const o = objects[id];
  const v = Number(value);
  if (!o || isGroup(o) || !Number.isFinite(v)) return null;
  if (kind !== "scale" && kind !== "position" && kind !== "rotation") return null;
  const i = kind === "scale" ? 0 : Math.trunc(Number(index));
  if (!(i >= 0 && i < 3)) return null;
  return planned(
    (d) => {
      const x = d.objects?.[id];
      if (!x) return;
      if (!x.transform) x.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
      if (kind === "scale") x.transform.scale = v > 0 ? v : 1;
      else {
        if (!Array.isArray(x.transform[kind])) x.transform[kind] = [0, 0, 0];
        x.transform[kind][i] = v;
      }
    },
    { id },
  );
}
