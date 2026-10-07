// Scene-object attachment (`scene.objects[id].parent`), as pure functions over
// the scene doc's `objects` map. A child's transform is relative to its parent:
// world = parentWorld · local. Pure; no three.
//
// The doc can hold a cycle even though the UI never writes one (two people
// attach A→B and B→A at the same moment and both merge). Everything here reads
// parents through resolveParents(), which breaks each cycle at its
// smallest id, so every peer sees the same tree.

import { composeMatrix, decomposeMatrix, IDENTITY_MATRIX, invertMatrix, multiplyMatrices, normalizeTransform } from "./transform.js";

/** The parent as written, if it names another object that exists; else null. */
export function rawParent(objects, id) {
  const p = objects?.[id]?.parent;
  return typeof p === "string" && p !== id && objects?.[p] ? p : null;
}

/** Map id → effective parent id (or null), with any cycle broken deterministically. */
export function resolveParents(objects) {
  const ids = Object.keys(objects ?? {});
  const parents = new Map(ids.map((id) => [id, rawParent(objects, id)]));
  const state = new Map(); // id → 1 visiting, 2 done
  for (const start of ids) {
    if (state.get(start) === 2) continue;
    const path = [];
    let id = start;
    while (id != null && !state.has(id)) {
      state.set(id, 1);
      path.push(id);
      id = parents.get(id);
    }
    if (id != null && state.get(id) === 1) {
      // `id` is on the current path: path from it to the end is a cycle
      const cycle = path.slice(path.indexOf(id));
      const root = [...cycle].sort()[0];
      parents.set(root, null);
    }
    for (const p of path) state.set(p, 2);
  }
  return parents;
}

/**
 * Objects whose written parent resolveParents() ignores to break a cycle: the
 * root it picked for each one. The losing edge is still in the doc, and would
 * quietly come back (moving the object) once some other re-parent makes it
 * acyclic, so a local hierarchy write should clear it: parent = null, with the
 * transform as it is (a resolved root's transform is already its world pose).
 */
export function brokenParents(objects, parents = resolveParents(objects)) {
  return Object.keys(objects ?? {}).filter((id) => rawParent(objects, id) != null && parents.get(id) == null);
}

/** Ancestors of id, nearest first. */
export function ancestors(objects, id, parents = resolveParents(objects)) {
  const out = [];
  for (let p = parents.get(id); p != null; p = parents.get(p)) out.push(p);
  return out;
}

/** Every object below id (children, their children, …). */
export function descendants(objects, id, parents = resolveParents(objects)) {
  const kids = new Map();
  for (const [child, p] of parents) {
    if (p == null) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(child);
  }
  const out = new Set();
  const queue = [...(kids.get(id) ?? [])];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    if (out.has(c)) continue;
    out.add(c);
    for (const k of kids.get(c) ?? []) queue.push(k);
  }
  return out;
}

/** True if making `parent` the parent of `id` would make a loop (or is id itself). */
export function wouldCycle(objects, id, parent, parents = resolveParents(objects)) {
  if (parent == null) return false;
  if (parent === id) return true;
  return descendants(objects, id, parents).has(parent);
}

/** The objects `id` may be attached to: every other one that isn't below it. */
export function attachTargets(objects, id, parents = resolveParents(objects)) {
  const below = descendants(objects, id, parents);
  return Object.keys(objects ?? {}).filter((o) => o !== id && !below.has(o));
}

/** An object's world matrix: its ancestors' transforms composed with its own. */
export function worldMatrix(objects, id, parents = resolveParents(objects)) {
  if (!objects?.[id]) return [...IDENTITY_MATRIX];
  let m = composeMatrix(objects[id].transform);
  for (const p of ancestors(objects, id, parents)) m = multiplyMatrices(composeMatrix(objects[p].transform), m);
  return m;
}

/** The world pose of an object, as a transform (what its transform would be at the root). */
export function worldTransform(objects, id, parents = resolveParents(objects)) {
  return decomposeMatrix(worldMatrix(objects, id, parents));
}

/**
 * The local transform that keeps `id` exactly where it is in the world once
 * its parent becomes `parent` (null = the scene root).
 */
export function reparentTransform(objects, id, parent, parents = resolveParents(objects)) {
  const world = worldMatrix(objects, id, parents);
  if (parent == null || !objects?.[parent]) return decomposeMatrix(world);
  const inv = invertMatrix(worldMatrix(objects, parent, parents));
  if (!inv) return normalizeTransform(objects[id].transform);
  return decomposeMatrix(multiplyMatrices(inv, world));
}

/**
 * Attach `id` to `parent` (null detaches), preserving its world pose.
 * @returns {{ parent: string | null, transform } | null}  null when it would make a cycle
 */
export function planAttach(objects, id, parent, parents = resolveParents(objects)) {
  if (!objects?.[id]) return null;
  const target = parent && objects[parent] ? parent : null;
  if (wouldCycle(objects, id, target, parents)) return null;
  return { parent: target, transform: reparentTransform(objects, id, target, parents) };
}

/**
 * What removing `id` does to its children: each moves to the scene root with
 * a local transform equal to its current world pose.
 * @returns {{ [childId]: transform }}
 */
export function orphanTransforms(objects, id, parents = resolveParents(objects)) {
  const out = {};
  for (const [child, p] of parents) if (p === id) out[child] = worldTransform(objects, child, parents);
  return out;
}

/**
 * The outline order: roots in `orderedIds` order, each followed by its
 * children (in the same relative order), depth-first.
 * @returns {{ id: string, depth: number }[]}
 */
export function treeOrder(objects, orderedIds, parents = resolveParents(objects)) {
  const kids = new Map();
  const roots = [];
  const listed = new Set(orderedIds);
  for (const id of orderedIds) {
    const p = parents.get(id) ?? null;
    if (p == null || !listed.has(p)) roots.push(id);
    else {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(id);
    }
  }
  const out = [];
  // iterative depth-first walk (a deep tree must not overflow the stack)
  const stack = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push([roots[i], 0]);
  while (stack.length) {
    const [id, depth] = stack.pop();
    out.push({ id, depth });
    const cs = kids.get(id);
    if (cs) for (let i = cs.length - 1; i >= 0; i--) stack.push([cs[i], depth + 1]);
  }
  return out;
}
