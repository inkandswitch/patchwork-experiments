// What a stage derives from a snapshot of its doc, once per snapshot: the
// objects in order, who hangs on whom, the groups and their members at any
// depth, what each object inherits for display, the order objects attach in,
// and the frozen value extensions read as `scene()` (API.md, "`api`"). Pure.

import * as ops from "../shared/ops.js";
import { resolveParents, treeOrder, worldMatrix } from "../shared/hierarchy.js";
import { groupChain, inheritedDisplay, isGroup, outlineParents, resolveGroups } from "../shared/groups.js";
import { applyMatrix, invertMatrix } from "../shared/transform.js";

/**
 * The derived structure of doc snapshot `d`. Merged cycles are broken here,
 * for reading (resolveParents and resolveGroups pick the same edge on every
 * peer); the ops repair them in the doc on the next structural write.
 * @returns {{ d, objects, ids, parents, groups, inherited, attachOrder, members: Map<string, string[]>, snapshot: null }}
 */
export function modelOf(d) {
  const objects = d.objects ?? {};
  const ids = ops.orderedIds(d);
  const parents = resolveParents(objects);
  const groups = resolveGroups(objects);
  const outline = outlineParents(objects, parents, groups);
  // who is in each group (at any depth): the viewport boxes and frames them
  const members = new Map();
  for (const id of Object.keys(objects)) {
    if (isGroup(objects[id])) {
      if (!members.has(id)) members.set(id, []);
      continue;
    }
    for (const g of groupChain(groups, id)) {
      if (!members.has(g)) members.set(g, []);
      members.get(g).push(id);
    }
  }
  return {
    d,
    objects,
    ids,
    parents,
    groups,
    inherited: inheritedDisplay(objects, outline),
    attachOrder: treeOrder(objects, ids, parents),
    members,
    snapshot: null,
  };
}

/**
 * The snapshot extensions read (`scene()`) of model `m`, made once per model:
 * its doc, structure, `world(id)` and `toLocal(id, point)`, each matrix
 * worked out once when first asked.
 */
export function snapshotOf(m) {
  if (!m.snapshot) {
    const worlds = new Map();
    const world = (id) => {
      let w = worlds.get(id);
      if (!w) worlds.set(id, (w = worldMatrix(m.objects, id, m.parents)));
      return w;
    };
    const inverses = new Map();
    const toLocal = (id, p) => {
      let inv = inverses.get(id);
      if (inv === undefined) inverses.set(id, (inv = invertMatrix(world(id))));
      return inv ? applyMatrix(inv, p) : null;
    };
    m.snapshot = Object.freeze({ d: m.d, objects: m.objects, ids: m.ids, parents: m.parents, groups: m.groups, members: m.members, traits: m.d.traits ?? {}, world, toLocal });
  }
  return m.snapshot;
}
