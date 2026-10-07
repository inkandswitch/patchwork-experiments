// Group objects (SCENE-CONTRACT v3 §7) and the outline's tree view, as pure
// functions over the scene doc's `objects` map. No DOM, no three.
//
// A group is an object with `kind: "group"`: no geometry, but a transform, a
// visibility and an opacity that cascade to everything below it. Non-group
// parents keep v2 §5 semantics: hiding an object doesn't hide what is attached
// to it. `parents` is always resolveParents(objects) (cycles already broken).

import { reparentTransform, resolveParents } from "./hierarchy.js";

export const isGroup = (o) => o?.kind === "group";

const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

/** Map parent id → child ids, in the order `ids` lists them (default: parents' key order). */
export function childrenMap(parents, ids = [...parents.keys()]) {
  const kids = new Map();
  for (const id of ids) {
    const p = parents.get(id) ?? null;
    if (p == null) continue;
    let list = kids.get(p);
    if (!list) kids.set(p, (list = []));
    list.push(id);
  }
  return kids;
}

/**
 * What each object inherits from its GROUP ancestors: visible = every group
 * ancestor is visible; opacity = the product of their opacities.
 * @returns {Map<string, { visible: boolean, opacity: number }>}
 */
export function inheritedDisplay(objects, parents = resolveParents(objects)) {
  const memo = new Map();
  const ROOT = Object.freeze({ visible: true, opacity: 1 });
  const get = (id) => {
    let m = memo.get(id);
    if (m) return m;
    // iterative walk up to the first memoised ancestor, then fill back down
    const chain = [];
    let cur = id;
    while (cur != null && !memo.has(cur)) {
      chain.push(cur);
      cur = parents.get(cur) ?? null;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      const p = parents.get(c) ?? null;
      if (p == null) memo.set(c, ROOT);
      else {
        const pi = memo.get(p);
        const po = objects[p];
        memo.set(c, isGroup(po) ? { visible: pi.visible && po.visible !== false, opacity: pi.opacity * clamp01(po.opacity ?? 1) } : pi);
      }
    }
    return memo.get(id);
  };
  for (const id of Object.keys(objects ?? {})) get(id);
  return memo;
}

/** Effective visibility: its own flag and every group ancestor's. */
export function effectivelyVisible(objects, id, inherited) {
  const o = objects?.[id];
  return !!o && o.visible !== false && (inherited.get(id)?.visible ?? true);
}

/**
 * Groups that have something hidden below them (an object or group whose own
 * `visible` is false, at any depth): their checkbox shows indeterminate.
 * @returns {Set<string>}
 */
export function groupsWithHidden(objects, parents = resolveParents(objects)) {
  const out = new Set();
  for (const [id, o] of Object.entries(objects ?? {})) {
    if (o?.visible !== false) continue;
    for (let p = parents.get(id); p != null; p = parents.get(p)) {
      if (!isGroup(objects[p])) continue;
      if (out.has(p)) break;
      out.add(p);
    }
  }
  return out;
}

/** Every object below id, via a children map (breadth first). */
export function descendantsOf(kids, id) {
  const out = [];
  const queue = [...(kids.get(id) ?? [])];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    out.push(c);
    for (const k of kids.get(c) ?? []) queue.push(k);
  }
  return out;
}

/** What "Remove" takes away: a group with everything below it; an object alone. */
export function removalSet(objects, id, parents = resolveParents(objects)) {
  if (!objects?.[id]) return [];
  if (!isGroup(objects[id])) return [id];
  return [id, ...descendantsOf(childrenMap(parents), id)];
}

/**
 * Ungroup: each direct child moves to the group's parent (or the root),
 * keeping its world pose and how it looks: the group's own visibility and
 * opacity (which it no longer inherits) fold into the child's, so a hidden
 * group's contents stay hidden and an x-rayed one's stay translucent.
 * @returns {{ parent: string | null, children: { [childId]: transform },
 *   display: { [childId]: { visible?: false, opacity?: number } } }}  display: only what changes
 */
export function ungroupPlan(objects, id, parents = resolveParents(objects)) {
  const parent = parents.get(id) ?? null;
  const group = objects?.[id];
  const hidden = group?.visible === false;
  const alpha = clamp01(group?.opacity ?? 1);
  const children = {};
  const display = {};
  for (const [child, p] of parents) {
    if (p !== id) continue;
    children[child] = reparentTransform(objects, child, parent, parents);
    const c = objects[child];
    const d = {};
    if (hidden && c?.visible !== false) d.visible = false;
    if (alpha < 1) d.opacity = clamp01(c?.opacity ?? 1) * alpha;
    if (Object.keys(d).length) display[child] = d;
  }
  return { parent, children, display };
}

/** Names of an object's ancestors, root first. */
export function pathNames(objects, id, parents) {
  const names = [];
  for (let p = parents.get(id); p != null; p = parents.get(p)) names.unshift(objects[p]?.name || "");
  return names;
}

/** Search terms: lower-case, whitespace separated, empty ones dropped. */
export const searchTerms = (query) => String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The outline filter: a case-insensitive AND of terms over each object's name
 * and its full group path. View-only.
 * @returns {{ matches: Set<string>, shown: Set<string>, first: string | null }}  shown = matches + their ancestors
 */
export function searchOutline(objects, query, parents = resolveParents(objects), orderedIds = Object.keys(objects ?? {})) {
  const terms = searchTerms(query);
  const matches = new Set();
  const shown = new Set();
  let first = null;
  if (!terms.length) return { matches, shown, first };
  const hayCache = new Map();
  const hay = (id) => {
    let h = hayCache.get(id);
    if (h == null) {
      const p = parents.get(id);
      h = `${p != null ? hay(p) + " / " : ""}${String(objects[id]?.name ?? "").toLowerCase()}`;
      hayCache.set(id, h);
    }
    return h;
  };
  for (const id of orderedIds) {
    if (!objects[id]) continue;
    const h = hay(id);
    if (!terms.every((t) => h.includes(t))) continue;
    matches.add(id);
    first ??= id;
    for (let c = id; c != null && !shown.has(c); c = parents.get(c)) shown.add(c);
  }
  return { matches, shown, first };
}

/** Default expansion: a visible root group is open; deeper groups are closed; an object with attachments is open. */
export function defaultExpanded(objects, id, depth) {
  const o = objects?.[id];
  if (isGroup(o)) return depth === 0 && o.visible !== false;
  return true;
}

/**
 * The rows the outline shows: `tree` (treeOrder's output) minus the subtrees
 * of collapsed rows, or — while filtering — just the shown ids, all open.
 * @param {{ id: string, depth: number }[]} tree
 * @param {{ isExpanded: (id, depth) => boolean, hasChildren: (id) => boolean, shown?: Set<string> | null }} o
 * @returns {{ id: string, depth: number, expanded: boolean, hasChildren: boolean }[]}
 */
export function visibleRows(tree, { isExpanded, hasChildren, shown = null }) {
  const out = [];
  let skipBelow = Infinity;
  for (const { id, depth } of tree) {
    if (depth > skipBelow) continue;
    skipBelow = Infinity;
    if (shown && !shown.has(id)) {
      skipBelow = depth; // nothing under a row that isn't shown can be shown
      continue;
    }
    const kids = hasChildren(id);
    const expanded = kids && (shown ? true : isExpanded(id, depth));
    out.push({ id, depth, expanded, hasChildren: kids });
    if (kids && !expanded) skipBelow = depth;
  }
  return out;
}
