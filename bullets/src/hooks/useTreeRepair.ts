import { createEffect, untrack, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";
import { detectTreeIssues, getReachableIds } from "../tree-utils.ts";

export function useTreeRepair(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  structuralVersion: Accessor<number>;
}) {
  const { doc, handle } = deps;

  // Post-merge structural repair
  createEffect(() => {
    deps.structuralVersion();
    untrack(() => {
      if (!doc.nodes || !doc.rootId) return;

      const { duplicates, cycles, orphanedEntries, orphanedCycles } = detectTreeIssues(doc);
      if (duplicates.length === 0 && cycles.length === 0 && orphanedEntries.length === 0) return;

      const reachable = getReachableIds(doc);

      handle.change((d) => {
        // Phase 1: Re-attach orphaned cycle entry nodes
        for (const nodeId of orphanedEntries) {
          const node = d.nodes[nodeId];
          const originPid = node?.originParentId;
          const originParent = originPid ? d.nodes[originPid] : null;
          if (originPid && reachable.has(originPid) && originParent) {
            const idx = Math.min(node.originIndex ?? originParent.children.length, originParent.children.length);
            originParent.children.splice(idx, 0, nodeId);
          } else {
            d.nodes[d.rootId].children.push(nodeId);
          }
        }

        // Phase 2: Remove bad edges
        const allEdgesToRemove = [...duplicates, ...cycles, ...orphanedCycles];
        const byParent = new Map<string, number[]>();
        for (const edge of allEdgesToRemove) {
          if (!byParent.has(edge.parentId)) byParent.set(edge.parentId, []);
          byParent.get(edge.parentId)!.push(edge.index);
        }
        for (const [parentId, indices] of byParent) {
          const parent = d.nodes[parentId];
          if (!parent) continue;
          indices.sort((a, b) => b - a);
          for (const idx of indices) {
            if (idx < parent.children.length) {
              parent.children.splice(idx, 1);
            }
          }
        }
      });
    });
  });

  // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
  // Clear mirroredIds from old docs so tree repair treats duplicates as unintended.
  createEffect(() => {
    if (doc.mirroredIds && doc.mirroredIds.length > 0) {
      handle.change((d) => {
        if (d.mirroredIds) d.mirroredIds.splice(0, d.mirroredIds.length);
      });
    }
  });

  // Repair duplicate entries in starredIds
  createEffect(() => {
    const ids = doc.starredIds;
    if (!ids) return;
    const seen = new Set<string>();
    let hasDuplicates = false;
    for (const id of ids) {
      if (seen.has(id)) { hasDuplicates = true; break; }
      seen.add(id);
    }
    if (!hasDuplicates) return;
    handle.change((d) => {
      if (!d.starredIds) return;
      const unique = [...new Set(d.starredIds)];
      d.starredIds.splice(0, d.starredIds.length, ...unique);
    });
  });
}
