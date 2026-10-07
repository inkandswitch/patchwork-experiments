// Where a drag lands in the object tree.
//
// Two kinds of drag end here — a document coming in from the sidebar, and a
// row being moved inside the tree — and both need the same answer: which
// parent, and where among its children. Keeping that answer here, as a
// function of the row under the pointer, is what lets it be tested without a
// browser; tool.js only supplies the geometry and applies the result.

import { resolveParents, wouldCycle } from "./hierarchy.js";

/** A group's middle band means "inside it". A leaf has no middle. */
export const INTO_BAND = 0.25;

/**
 * What the pointer is asking for, from the row under it and how far down that
 * row it sits (0 at the top edge, 1 at the bottom).
 *
 * A leaf cannot contain anything, so its row splits in half and the only
 * answers are before and after. A group splits in three, and the middle — the
 * half of it — is "into", which is the common case: you are pointing at the
 * group because you mean the group.
 *
 * @returns {"into" | "before" | "after"}
 */
export function dropIntent(isGroup, fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  if (!isGroup) return f < 0.5 ? "before" : "after";
  if (f < INTO_BAND) return "before";
  if (f > 1 - INTO_BAND) return "after";
  return "into";
}

/**
 * Turn an intent about a row into a place: which parent, and which sibling to
 * go in front of (null = last).
 *
 * `order` is a flat list of every id in the document, not a per-parent list, so
 * "before the next sibling" has to be found by walking forward through it for
 * the next id with the same parent. Anything between them is a descendant, and
 * inserting in front of a descendant would land inside the very subtree we are
 * trying to follow.
 */
export function placementFor(objects, order, rowId, intent, parents = resolveParents(objects), { expanded = false } = {}) {
  if (!rowId || !objects?.[rowId]) return { parent: null, before: null };
  if (intent === "into") return { parent: rowId, before: null };
  const ids = order ?? [];

  // Below an open row with children, the line the user sees is the one between
  // that row and its first child, so that is where the drop goes: inside, at
  // the top. Going after the whole subtree would land many rows further down
  // than the line that was drawn.
  if (intent === "after" && expanded) {
    const first = ids.find((id) => objects[id] && parents.get(id) === rowId);
    if (first) return { parent: rowId, before: first };
  }

  const parent = parents.get(rowId) ?? null;
  if (intent === "before") return { parent, before: rowId };
  return { parent, before: nextSibling(objects, ids, rowId, parent, parents) };
}

/** The next id after `id` in `order` with the same parent, or null. */
function nextSibling(objects, order, id, parent, parents) {
  const at = order.indexOf(id);
  for (let i = at + 1; i < order.length; i++) {
    const next = order[i];
    if (!objects[next]) continue;
    if ((parents.get(next) ?? null) === parent) return next;
  }
  return null;
}

/**
 * The ids with `parent`, in order: what a move actually changes. The flat
 * `order` can differ while this stays the same (a subtree's members are
 * interleaved with it), so this is what a drop is compared on to decide
 * whether it moved anything.
 */
export function siblings(objects, order, parent, parents = resolveParents(objects)) {
  return (order ?? []).filter((id) => objects?.[id] && (parents.get(id) ?? null) === parent);
}

/**
 * Would moving `id` to `place` change anything? False when it already has
 * that parent and its position among that parent's children stays the same —
 * including the drop of a row on itself, or on the line it already sits at.
 */
export function isMove(objects, order, id, place, parents = resolveParents(objects)) {
  if (!objects?.[id]) return false;
  const parent = place.parent && objects[place.parent] ? place.parent : null;
  if ((parents.get(id) ?? null) !== parent) return true;
  if (place.before === id) return false;
  const now = siblings(objects, order, parent, parents);
  const next = siblings(objects, moveInOrder(order, id, place.before), parent, parents);
  return now.length !== next.length || now.some((x, i) => x !== next[i]);
}

/**
 * Can `id` be moved to `parent`?
 *
 * Cycles are the real constraint and hierarchy.js already decides them. The
 * extra case is moving something onto itself, which is not a cycle by that
 * definition but is still not a move.
 */
export function canMove(objects, id, parent, parents = resolveParents(objects)) {
  if (!objects?.[id]) return false;
  if (parent === id) return false;
  return !wouldCycle(objects, id, parent && objects[parent] ? parent : null, parents);
}

/**
 * Inside an automerge change: move `id` in front of `before` (null = the end)
 * in the doc's own `order` list, by splicing rather than by assigning a new
 * list, so a peer's concurrent insert into the same list survives the merge.
 */
export function spliceOrder(list, id, before) {
  const from = list.indexOf(id);
  if (from >= 0) list.splice(from, 1);
  const at = before == null ? -1 : list.indexOf(before);
  if (at >= 0) list.splice(at, 0, id);
  else list.push(id);
}

/**
 * `order` with `id` moved in front of `before` (null = to the end).
 *
 * Pure, and returns a new array, so a caller can compare it with the old one
 * and skip the write when a drag ends where it started.
 */
export function moveInOrder(order, id, before) {
  const ids = (order ?? []).filter((x) => x !== id);
  if (before == null) return [...ids, id];
  const at = ids.indexOf(before);
  if (at < 0) return [...ids, id];
  return [...ids.slice(0, at), id, ...ids.slice(at)];
}
