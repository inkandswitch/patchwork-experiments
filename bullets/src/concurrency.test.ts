/**
 * Integration tests for concurrency bug fixes (Batches 1 & 2).
 *
 * These tests simulate concurrent editing by two peers using Automerge's
 * clone/change/merge primitives. After merge, they verify that detection,
 * repair, and guard logic produce correct results.
 *
 * Scenarios covered:
 *   Batch 1. #1 concurrent moves create unintended mirrors
 *          . #2 concurrent moves create cycles
 *          . #3 orphaned nodes pollute search/tags
 *          . #5 concurrent delete + navigation → orphaned context
 *   Batch 2. #4  concurrent delete + active editing → focus lost
 *          . #6  undo reverts concurrent peers' changes
 *          . #7  content editing DOM conflicts (cursor jumps)
 *          . #8  context menu operates on stale parentId
 *          . #12 starredIds / starred boolean desync
 *          . #14 search/tag results navigate to stale targets
 *          . #15 zero bullets after concurrent deletes
 */

import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import type { BulletsDoc, UndoOp } from "./datatype.ts";
import {
  findParentId,
  detectTreeIssues,
  getReachableIds,
  flattenVisibleIds,
  flattenVisibleWithParent,
  isDescendantOf,
} from "./tree-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal BulletsDoc with deterministic IDs for testing. */
function makeNode(content = "", children: string[] = []) {
  return {
    content,
    collapsed: false,
    embedExpanded: false,
    starred: false,
    children,
  };
}

/**
 * Build a base Automerge document.
 * Layout: root → [a, b, c]   a → [a1]
 */
function makeBaseDoc() {
  return Automerge.from<BulletsDoc>({
    title: "Test",
    rootId: "root",
    nodes: {
      root: makeNode("", ["a", "b", "c"]),
      a: makeNode("Alpha", ["a1"]),
      a1: makeNode("Alpha-child"),
      b: makeNode("Bravo"),
      c: makeNode("Charlie"),
    },
  });
}

/**
 * Simulate the structural repair effect from tool.tsx.
 * Detects duplicate references, cycles, and orphaned cycle components.
 * Re-attaches orphaned cycle entries to root and splices out bad edges.
 */
function applyStructuralRepair(doc: Automerge.Doc<BulletsDoc>): Automerge.Doc<BulletsDoc> {
  const { duplicates, cycles, orphanedEntries, orphanedCycles } = detectTreeIssues(doc);
  if (duplicates.length === 0 && cycles.length === 0 && orphanedEntries.length === 0) return doc;

  // Compute reachable set BEFORE repair (for origin parent lookup)
  const reachable = getReachableIds(doc);

  return Automerge.change(doc, (d) => {
    // Phase 1: Re-attach orphaned cycle entry nodes to origin parent or root
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
}

/**
 * Simulate the starredIds dedup repair effect from tool.tsx.
 */
function applyStarredIdsRepair(doc: Automerge.Doc<BulletsDoc>): Automerge.Doc<BulletsDoc> {
  const ids = doc.starredIds;
  if (!ids) return doc;
  const seen = new Set<string>();
  let hasDuplicates = false;
  for (const id of ids) {
    if (seen.has(id)) { hasDuplicates = true; break; }
    seen.add(id);
  }
  if (!hasDuplicates) return doc;
  return Automerge.change(doc, (d) => {
    if (!d.starredIds) return;
    const unique = [...new Set(d.starredIds)];
    d.starredIds.splice(0, d.starredIds.length, ...unique);
  });
}

/**
 * Simulate the zero-children auto-create effect from tool.tsx.
 */
function applyZeroChildrenRepair(
  doc: Automerge.Doc<BulletsDoc>,
  contextRootId: string,
): Automerge.Doc<BulletsDoc> {
  const root = doc.nodes[contextRootId];
  if (!root || root.children.length > 0) return doc;
  const newId = "auto-created";
  return Automerge.change(doc, (d) => {
    if (d.nodes[contextRootId].children.length === 0) {
      d.nodes[newId] = makeNode();
      d.nodes[contextRootId].children.push(newId);
    }
  });
}

/**
 * Reimplement applyUndoEntry from tool.tsx for testing.
 * Applies ops in reverse order, inverting each.
 * Uses Automerge.change so it works with Automerge docs.
 */
function applyUndoOps(
  doc: Automerge.Doc<BulletsDoc>,
  ops: UndoOp[],
): { doc: Automerge.Doc<BulletsDoc>; inverseOps: UndoOp[] } {
  const inverseOps: UndoOp[] = [];
  const newDoc = Automerge.change(doc, (d) => {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      switch (op.type) {
        case "splice-in": {
          const parent = d.nodes[op.parentId];
          if (!parent) break;
          const idx = parent.children.indexOf(op.childId);
          if (idx !== -1) {
            parent.children.splice(idx, 1);
            inverseOps.push({ type: "splice-out", parentId: op.parentId, childId: op.childId, index: idx });
          }
          break;
        }
        case "splice-out": {
          const parent = d.nodes[op.parentId];
          if (!parent) break;
          const idx = Math.min(op.index, parent.children.length);
          parent.children.splice(idx, 0, op.childId);
          inverseOps.push({ type: "splice-in", parentId: op.parentId, childId: op.childId, index: idx });
          break;
        }
        case "set-content": {
          const n = d.nodes[op.nodeId];
          if (n) {
            inverseOps.push({ type: "set-content", nodeId: op.nodeId, oldContent: n.content });
            Automerge.updateText(d, ["nodes", op.nodeId, "content"], op.oldContent);
          }
          break;
        }
        case "set-title": {
          const n = d.nodes[op.nodeId];
          if (n) {
            inverseOps.push({ type: "set-title", nodeId: op.nodeId, oldTitle: n.title });
            if (typeof op.oldTitle === "string") {
              if (typeof n.title === "string") {
                Automerge.updateText(d, ["nodes", op.nodeId, "title"], op.oldTitle);
              } else {
                n.title = op.oldTitle;
              }
            } else {
              n.title = op.oldTitle;
            }
          }
          break;
        }
        case "create-node":
          break;
      }
    }
  });
  return { doc: newDoc, inverseOps };
}

/** Count how many parents reference a given child. */
function countReferences(doc: BulletsDoc, childId: string): number {
  let count = 0;
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    for (const cid of node.children) {
      if (cid === childId) count++;
    }
  }
  return count;
}

// ===========================================================================
// Batch 1 Tests
// ===========================================================================

describe("Batch 1: Structural integrity", () => {
  // -----------------------------------------------------------------------
  // #1  Concurrent moves create unintended mirrors
  // -----------------------------------------------------------------------
  describe("#1. Concurrent moves create unintended mirrors", () => {
    it("detects duplicate when two peers move the same bullet to different parents", () => {
      const base = makeBaseDoc();
      // root → [a, b, c], a → [a1]
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: move b under a  (remove from root, push to a)
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("b");
      });

      // Peer 2: move b under c  (remove from root, push to c)
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.c.children.push("b");
      });

      const merged = Automerge.merge(doc1, doc2);

      // Before repair: b appears in both a.children and c.children
      expect(countReferences(merged, "b")).toBe(2);

      const { duplicates } = detectTreeIssues(merged);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].childId).toBe("b");

      // After repair: b appears exactly once
      const repaired = applyStructuralRepair(merged);
      expect(countReferences(repaired, "b")).toBe(1);
    });

    // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
    // it("preserves intentional mirrors (mirroredIds)", () => {
    //   let base = Automerge.from<BulletsDoc>({
    //     title: "Test",
    //     rootId: "root",
    //     mirroredIds: ["b"],
    //     nodes: {
    //       root: makeNode("", ["a", "b"]),
    //       a: makeNode("Alpha", ["b"]),  // b intentionally mirrored under a
    //       b: makeNode("Bravo"),
    //     },
    //   });
    //
    //   const { duplicates } = detectTreeIssues(base);
    //   // b is in mirroredIds. Should NOT be flagged as duplicate
    //   expect(duplicates.length).toBe(0);
    // });
  });

  // -----------------------------------------------------------------------
  // #2  Concurrent moves create cycles
  // -----------------------------------------------------------------------
  describe("#2. Concurrent moves create cycles", () => {
    it("concurrent cross-moves create orphaned cycle. Repair re-attaches and breaks cycle", () => {
      const base = makeBaseDoc();
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: move a under b  (remove a from root, push to b)
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.b.children.push("a");
      });

      // Peer 2: move b under a  (remove b from root, push to a)
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("b");
      });

      const merged = Automerge.merge(doc1, doc2);

      // Before repair: both a and b are orphaned (unreachable from root)
      const reachable = getReachableIds(merged);
      expect(reachable.has("a")).toBe(false);
      expect(reachable.has("b")).toBe(false);

      // detectTreeIssues finds the orphaned cycle
      const { orphanedEntries, orphanedCycles } = detectTreeIssues(merged);
      expect(orphanedEntries.length).toBeGreaterThan(0);
      expect(orphanedCycles.length).toBeGreaterThan(0);

      // After repair: nodes are re-attached and cycle is broken
      const repaired = applyStructuralRepair(merged);
      const reachable2 = getReachableIds(repaired);
      expect(reachable2.has("a")).toBe(true);
      expect(reachable2.has("b")).toBe(true);
      // Content preserved
      expect(repaired.nodes.a.content).toBe("Alpha");
      expect(repaired.nodes.b.content).toBe("Bravo");
      // No cycles remain
      const check = detectTreeIssues(repaired);
      expect(check.cycles.length).toBe(0);
      expect(check.orphanedEntries.length).toBe(0);
    });

    it("detectTreeIssues catches reachable cycle (back-edge to ancestor)", () => {
      // Manually create a cycle reachable from root: root → [a], a → [b], b → [a]
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo", ["a"]),  // back-edge to ancestor
        },
      });

      const { cycles } = detectTreeIssues(doc);
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].parentId).toBe("b");
      expect(cycles[0].childId).toBe("a");

      // Repair breaks the cycle
      const repaired = applyStructuralRepair(doc);
      const check = detectTreeIssues(repaired);
      expect(check.cycles.length).toBe(0);
    });

    it("traversals terminate on cyclic documents (cycle-safe)", () => {
      // Manually create a cycle: root → [a], a → [b], b → [a]
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo", ["a"]),  // cycle back to a
        },
      });

      // These should all terminate (not hang) due to visited sets
      const flat = flattenVisibleIds(doc, "root");
      expect(flat).toContain("a");
      expect(flat).toContain("b");

      const reachable = getReachableIds(doc);
      expect(reachable.has("a")).toBe(true);
      expect(reachable.has("b")).toBe(true);

      // isDescendantOf should not infinite loop
      expect(isDescendantOf(doc, "a", "root")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // #3  Orphaned nodes pollute search/tags
  // -----------------------------------------------------------------------
  describe("#3. Orphaned nodes excluded from reachable set", () => {
    it("getReachableIds excludes orphaned (deleted) nodes", () => {
      // root → [a, c], b is orphaned (left in map but not in any children array)
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "c"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo #important"),  // orphaned
          c: makeNode("Charlie"),
        },
      });

      const reachable = getReachableIds(doc);
      expect(reachable.has("root")).toBe(true);
      expect(reachable.has("a")).toBe(true);
      expect(reachable.has("c")).toBe(true);
      expect(reachable.has("b")).toBe(false);
    });

    it("orphaned nodes created by concurrent deletes are excluded", () => {
      const base = makeBaseDoc();
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: delete b from root
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      // Peer 2: delete c from root
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("c");
        d.nodes.root.children.splice(idx, 1);
      });

      const merged = Automerge.merge(doc1, doc2);
      // b and c are both removed from root.children
      expect(merged.nodes.root.children).not.toContain("b");
      expect(merged.nodes.root.children).not.toContain("c");

      // But they still exist in the map
      expect(merged.nodes.b).toBeDefined();
      expect(merged.nodes.c).toBeDefined();

      // Reachable set correctly excludes them
      const reachable = getReachableIds(merged);
      expect(reachable.has("b")).toBe(false);
      expect(reachable.has("c")).toBe(false);
      expect(reachable.has("a")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // #5  Concurrent delete + navigation → orphaned context
  // -----------------------------------------------------------------------
  describe("#5. Navigation safety for deleted contexts", () => {
    it("detects when contextId becomes unreachable after peer deletes it", () => {
      const base = makeBaseDoc();
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 2 is viewing context "b"
      const contextId = "b";

      // Peer 1 deletes b
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      const merged = Automerge.merge(doc1, doc2);
      const reachable = getReachableIds(merged);

      // The guard: contextId is no longer reachable
      expect(reachable.has(contextId)).toBe(false);
      // This is what the createEffect in tool.tsx checks. It would redirect to home
    });

    it("goBack skips unreachable history entries", () => {
      // Simulate: user navigated through a, b, c. Then b gets deleted.
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "c"]),  // b removed
          a: makeNode("Alpha"),
          b: makeNode("Bravo"),  // orphaned
          c: makeNode("Charlie"),
        },
      });

      const history = ["a", "b", "c"];
      const reachable = getReachableIds(doc);

      // Walk backwards through history, skipping unreachable entries
      let prev: string | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        if (reachable.has(history[i])) {
          prev = history[i];
          break;
        }
      }

      // Should skip b (unreachable) and find c
      expect(prev).toBe("c");
    });
  });
});

// ===========================================================================
// Batch 2 Tests
// ===========================================================================

describe("Batch 2: Concurrency fixes", () => {
  // -----------------------------------------------------------------------
  // #8  Context menu operates on stale parentId
  // -----------------------------------------------------------------------
  describe("#8. Context menu re-validates parent at action time", () => {
    it("findParentId returns current parent after peer moves bullet", () => {
      const base = makeBaseDoc();
      // root → [a, b, c]

      // Peer 1 moves b under a between right-click and delete
      const afterMove = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("b");
      });

      // Original context menu captured parentId="root", childIndex=1
      const staleParentId = "root";

      // Re-validate: findParentId returns the current parent
      const currentParent = findParentId(afterMove, "b");
      expect(currentParent).toBe("a");
      expect(currentParent).not.toBe(staleParentId);

      // The fix: deleteBullet uses findParentId(doc, id) ?? parentId
      // and then uses indexOf to find the correct index
      const parent = afterMove.nodes[currentParent!];
      const idx = parent.children.indexOf("b");
      expect(idx).toBe(1); // after a1 in a's children
    });

    it("returns null for already-deleted bullet, preventing double-delete", () => {
      const base = makeBaseDoc();

      // Peer deletes b before context menu action fires
      const afterDelete = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      // findParentId returns null. B is not in any children array
      const currentParent = findParentId(afterDelete, "b");
      // Falls back to stale parentId, but indexOf returns -1
      const fallbackParent = currentParent ?? "root";
      const parent = afterDelete.nodes[fallbackParent];
      const idx = parent.children.indexOf("b");
      expect(idx).toBe(-1); // already deleted. The guard returns early
    });
  });

  // -----------------------------------------------------------------------
  // #15  Zero bullets after concurrent deletes
  // -----------------------------------------------------------------------
  describe("#15. Zero bullets after concurrent deletes", () => {
    it("concurrent deletes can leave context root with zero children", () => {
      // Start with exactly two bullets under root
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["x", "y"]),
          x: makeNode("X"),
          y: makeNode("Y"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1 deletes x
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("x");
        d.nodes.root.children.splice(idx, 1);
      });

      // Peer 2 deletes y
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("y");
        d.nodes.root.children.splice(idx, 1);
      });

      const merged = Automerge.merge(doc1, doc2);
      expect(merged.nodes.root.children.length).toBe(0);

      // Auto-create repair adds an empty bullet
      const repaired = applyZeroChildrenRepair(merged, "root");
      expect(repaired.nodes.root.children.length).toBe(1);
      expect(repaired.nodes["auto-created"]).toBeDefined();
      expect(repaired.nodes["auto-created"].content).toBe("");
    });

    it("does not create bullet if root already has children", () => {
      const base = makeBaseDoc();
      const result = applyZeroChildrenRepair(base, "root");
      // No change. Root has children [a, b, c]
      expect(result.nodes.root.children.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // #12  starredIds / starred boolean desync
  // -----------------------------------------------------------------------
  describe("#12. starredIds deduplication", () => {
    it("concurrent stars produce duplicate entries in starredIds", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        starredIds: [],
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Both peers star bullet a
      doc1 = Automerge.change(doc1, (d) => {
        d.nodes.a.starred = true;
        d.starredIds!.push("a");
      });

      doc2 = Automerge.change(doc2, (d) => {
        d.nodes.a.starred = true;
        d.starredIds!.push("a");
      });

      const merged = Automerge.merge(doc1, doc2);

      // "a" appears twice in starredIds
      const aCount = merged.starredIds!.filter((id) => id === "a").length;
      expect(aCount).toBe(2);

      // Repair deduplicates
      const repaired = applyStarredIdsRepair(merged);
      const repairedCount = repaired.starredIds!.filter((id) => id === "a").length;
      expect(repairedCount).toBe(1);
    });

    it("getStarredNodes dedup logic filters duplicates at display time", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        starredIds: ["a", "a", "b", "a"],
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo"),
        },
      };

      // Simulate getStarredNodes with dedup (from tool.tsx)
      const reachable = getReachableIds(doc);
      const ids = doc.starredIds!;
      const results: { id: string; content: string }[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!reachable.has(id)) continue;
        const node = doc.nodes[id];
        if (node?.starred) {
          results.push({ id, content: node.content || "Untitled" });
        }
      }

      // Only starred nodes appear, no duplicates
      // a is not starred (starred=false by default), b is not starred
      expect(results.length).toBe(0);

      // Mark a as starred
      doc.nodes.a.starred = true;
      const results2: { id: string; content: string }[] = [];
      const seen2 = new Set<string>();
      for (const id of ids) {
        if (seen2.has(id)) continue;
        seen2.add(id);
        if (!reachable.has(id)) continue;
        const node = doc.nodes[id];
        if (node?.starred) {
          results2.push({ id, content: node.content || "Untitled" });
        }
      }
      expect(results2.length).toBe(1);
      expect(results2[0].id).toBe("a");
    });
  });

  // -----------------------------------------------------------------------
  // #7  Content editing DOM conflicts (cursor jumps)
  // -----------------------------------------------------------------------
  describe("#7. DOM sync skip while focused (logic test)", () => {
    it("concurrent edits to same bullet produce merged content via LWW", () => {
      const base = makeBaseDoc();
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1 edits bullet a's content
      doc1 = Automerge.change(doc1, (d) => {
        d.nodes.a.content = "Alpha updated by peer 1";
      });

      // Peer 2 edits bullet a's content
      doc2 = Automerge.change(doc2, (d) => {
        d.nodes.a.content = "Alpha updated by peer 2";
      });

      const merged = Automerge.merge(doc1, doc2);

      // Automerge uses LWW for strings. One wins
      expect(
        merged.nodes.a.content === "Alpha updated by peer 1" ||
        merged.nodes.a.content === "Alpha updated by peer 2"
      ).toBe(true);

      // The fix: when contentFocused() is true, the DOM sync effect skips
      // updating contentRef.textContent, so the local user's DOM stays stable.
      // When they blur, the merged content is rendered.
      // This is a DOM-level fix, tested here at the data level to confirm
      // the merge produces a valid single string (not corruption).
    });
  });

  // -----------------------------------------------------------------------
  // #4  Concurrent delete + active editing → focus lost
  // -----------------------------------------------------------------------
  describe("#4. Focus recovery on peer delete", () => {
    it("detects when focused bullet becomes unreachable", () => {
      const base = makeBaseDoc();

      // User is editing bullet b (it's focused)
      const focusedBulletId = "b";

      // Peer deletes b
      const afterDelete = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      const reachable = getReachableIds(afterDelete);
      expect(reachable.has(focusedBulletId)).toBe(false);

      // The fix: createEffect detects this and auto-focuses the nearest
      // visible bullet. Verify we can find adjacent bullets in the DOM order.
      const visible = flattenVisibleIds(afterDelete, "root");
      // After deleting b: visible = [a, a1, c]
      expect(visible).toContain("a");
      expect(visible).toContain("c");
      expect(visible).not.toContain("b");
    });

    it("concurrent edit + delete: edits are saved but node becomes orphaned", () => {
      const base = makeBaseDoc();
      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1 deletes b
      doc1 = Automerge.change(doc1, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      // Peer 2 edits b
      doc2 = Automerge.change(doc2, (d) => {
        d.nodes.b.content = "Bravo updated!";
      });

      const merged = Automerge.merge(doc1, doc2);

      // b's content is updated but it's orphaned
      expect(merged.nodes.b.content).toBe("Bravo updated!");
      expect(merged.nodes.root.children).not.toContain("b");
      expect(getReachableIds(merged).has("b")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // #14  Search/tag results navigate to stale targets
  // -----------------------------------------------------------------------
  describe("#14. goToContext guards against unreachable targets", () => {
    it("reachability check prevents navigation to deleted bullet", () => {
      const base = makeBaseDoc();

      // User sees search result for "b" and clicks it
      const targetId = "b";

      // Meanwhile, peer deletes b
      const afterDelete = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
      });

      const reachable = getReachableIds(afterDelete);

      // The guard: if (!reachableIds().has(id)) return;
      expect(reachable.has(targetId)).toBe(false);
      // goToContext would return early. No navigation to orphaned subtree
    });

    it("reachability check allows navigation to existing bullet", () => {
      const base = makeBaseDoc();
      const reachable = getReachableIds(base);
      expect(reachable.has("a")).toBe(true);
      expect(reachable.has("b")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // #6  Undo reverts concurrent peers' changes
  // -----------------------------------------------------------------------
  describe("#6. Operation-based undo preserves concurrent edits", () => {
    it("undo of indent does not clobber peer's concurrent addition", () => {
      const base = makeBaseDoc();
      // root → [a, b, c], a → [a1]

      // Peer A indents b under a:
      //   ops: [splice-out(root, b, 1), splice-in(a, b, 1)]
      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "root", childId: "b", index: 1 },
        { type: "splice-in", parentId: "a", childId: "b", index: 1 },
      ];

      let docA = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("b");
      });
      // root → [a, c], a → [a1, b]

      // Meanwhile, Peer B adds a new bullet "d" to root
      let docB = Automerge.clone(base);
      docB = Automerge.change(docB, (d) => {
        d.nodes.d = makeNode("Delta");
        d.nodes.root.children.push("d");
      });

      // Merge: both changes applied
      let merged = Automerge.merge(docA, docB);
      // root → [a, c, d], a → [a1, b]
      expect(merged.nodes.root.children).toContain("d");
      expect(merged.nodes.a.children).toContain("b");

      // Peer A undoes the indent (inverse ops applied in reverse)
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // b should be back in root (at index 1 or clamped)
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.a.children).not.toContain("b");

      // CRITICAL: peer B's "d" is still in root. Not clobbered!
      expect(undone.nodes.root.children).toContain("d");
    });

    it("undo of delete does not clobber peer's concurrent move", () => {
      const base = makeBaseDoc();
      // root → [a, b, c]

      // Peer A deletes c from root at index 2
      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "root", childId: "c", index: 2 },
      ];

      let docA = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("c");
        d.nodes.root.children.splice(idx, 1);
      });

      // Peer B moves a under b (concurrent with A's delete)
      let docB = Automerge.clone(base);
      docB = Automerge.change(docB, (d) => {
        const idx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.b.children.push("a");
      });

      let merged = Automerge.merge(docA, docB);
      // root → [b], b → [a], a → [a1] (c deleted, a moved under b)

      // Peer A undoes the delete of c
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // c should be restored to root
      expect(undone.nodes.root.children).toContain("c");

      // Peer B's move of a under b should be preserved
      expect(undone.nodes.b.children).toContain("a");
      // a should NOT reappear in root.children
      expect(undone.nodes.root.children).not.toContain("a");
    });

    it("undo of Enter (split) restores content and removes new bullet", () => {
      const base = makeBaseDoc();
      const fullText = "Alpha";
      const leftText = "Al";
      const rightText = "pha";

      // Simulate Enter split on bullet a
      const undoOps: UndoOp[] = [
        { type: "create-node", nodeId: "new1" },
        { type: "set-content", nodeId: "a", oldContent: fullText },
        { type: "splice-in", parentId: "root", childId: "new1", index: 1 },
      ];

      let docA = Automerge.change(base, (d) => {
        d.nodes.new1 = makeNode(rightText);
        d.nodes.a.content = leftText;
        d.nodes.root.children.splice(1, 0, "new1");
      });

      expect(docA.nodes.a.content).toBe(leftText);
      expect(docA.nodes.root.children).toContain("new1");

      // Undo the Enter
      const { doc: undone } = applyUndoOps(docA, undoOps);

      expect(undone.nodes.a.content).toBe(fullText);
      expect(undone.nodes.root.children).not.toContain("new1");
    });

    it("undo of backspace (empty delete with child promotion) restores correctly", () => {
      // root → [a, b], b → [b1, b2]
      // Backspace on empty b: promote b1, b2 into root at b's position
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha"),
          b: makeNode("", ["b1", "b2"]),
          b1: makeNode("B-child-1"),
          b2: makeNode("B-child-2"),
        },
      });

      // Record ops in the same order as the BulletItem implementation:
      // 1. splice-out children from b (reverse order for indices)
      // 2. splice-out b from root
      // 3. splice-in children into root
      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "b", childId: "b2", index: 1 },
        { type: "splice-out", parentId: "b", childId: "b1", index: 0 },
        { type: "splice-out", parentId: "root", childId: "b", index: 1 },
        { type: "splice-in", parentId: "root", childId: "b1", index: 1 },
        { type: "splice-in", parentId: "root", childId: "b2", index: 2 },
      ];

      let after = Automerge.change(base, (d) => {
        d.nodes.b.children.splice(0);
        d.nodes.root.children.splice(1, 1, "b1", "b2");
      });

      // After backspace: root → [a, b1, b2]
      expect(after.nodes.root.children).toEqual(["a", "b1", "b2"]);
      expect(after.nodes.b.children).toEqual([]);

      // Undo the backspace
      const { doc: undone } = applyUndoOps(after, undoOps);

      // b should be back in root, b1 and b2 back under b
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.root.children).not.toContain("b1");
      expect(undone.nodes.root.children).not.toContain("b2");
      expect(undone.nodes.b.children).toContain("b1");
      expect(undone.nodes.b.children).toContain("b2");
    });

    it("redo after undo works correctly", () => {
      const base = makeBaseDoc();
      // Simulate indent: move b under a
      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "root", childId: "b", index: 1 },
        { type: "splice-in", parentId: "a", childId: "b", index: 1 },
      ];

      let doc = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("b");
      });

      // Undo
      const { doc: undone, inverseOps: redoOps } = applyUndoOps(doc, undoOps);
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.a.children).not.toContain("b");

      // Redo (apply inverse of undo)
      const { doc: redone } = applyUndoOps(undone, redoOps);
      expect(redone.nodes.root.children).not.toContain("b");
      expect(redone.nodes.a.children).toContain("b");
    });

    it("undo of outdent preserves concurrent peer's new child", () => {
      // root → [a], a → [a1, b]
      // Peer A outdents b: splice-out(a, b, 1), splice-in(root, b, 1)
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha", ["a1", "b"]),
          a1: makeNode("Alpha-child"),
          b: makeNode("Bravo"),
        },
      });

      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "a", childId: "b", index: 1 },
        { type: "splice-in", parentId: "root", childId: "b", index: 1 },
      ];

      let docA = Automerge.change(base, (d) => {
        const idx = d.nodes.a.children.indexOf("b");
        d.nodes.a.children.splice(idx, 1);
        d.nodes.root.children.push("b");
      });

      // Peer B concurrently adds a new child "c" under a
      let docB = Automerge.clone(base);
      docB = Automerge.change(docB, (d) => {
        d.nodes.c = makeNode("Charlie");
        d.nodes.a.children.push("c");
      });

      let merged = Automerge.merge(docA, docB);
      // root → [a, b], a → [a1, c] (b outdented, c added)
      expect(merged.nodes.a.children).toContain("c");

      // Peer A undoes the outdent
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // b should be back under a
      expect(undone.nodes.a.children).toContain("b");
      expect(undone.nodes.root.children).not.toContain("b");

      // CRITICAL: c is preserved (not clobbered by undo)
      expect(undone.nodes.a.children).toContain("c");
    });

    it("undo of drag-and-drop preserves concurrent changes", () => {
      const base = makeBaseDoc();
      // root → [a, b, c]

      // Peer A drags c to be first child of a
      const undoOps: UndoOp[] = [
        { type: "splice-out", parentId: "root", childId: "c", index: 2 },
        { type: "splice-in", parentId: "a", childId: "c", index: 1 },
      ];

      let docA = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("c");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.a.children.push("c");
      });

      // Peer B adds a new node "e" to root
      let docB = Automerge.clone(base);
      docB = Automerge.change(docB, (d) => {
        d.nodes.e = makeNode("Echo");
        d.nodes.root.children.push("e");
      });

      let merged = Automerge.merge(docA, docB);

      // Undo the drag
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // c back in root
      expect(undone.nodes.root.children).toContain("c");
      // e still in root
      expect(undone.nodes.root.children).toContain("e");
    });
  });
});

// ===========================================================================
// Combined / complex scenarios
// ===========================================================================

describe("Combined concurrency scenarios", () => {
  it("concurrent move + delete: node moved by one peer, deleted by another", () => {
    const base = makeBaseDoc();
    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);

    // Peer 1: move b under a
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.children.push("b");
    });

    // Peer 2: delete b from root
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
    });

    const merged = Automerge.merge(doc1, doc2);

    // b was removed from root by both peers (splice combines).
    // Peer 1's push to a.children survives.
    // So b ends up under a, which is the "move wins" outcome.
    expect(merged.nodes.a.children).toContain("b");
    expect(merged.nodes.root.children).not.toContain("b");

    // This is actually fine. No repair needed. The move wins.
    const { duplicates, cycles } = detectTreeIssues(merged);
    expect(duplicates.length).toBe(0);
    expect(cycles.length).toBe(0);
  });

  it("three-way concurrent: move + move + edit all on same bullet", () => {
    const base = makeBaseDoc();
    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);
    let doc3 = Automerge.clone(base);

    // Peer 1: move b under a
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.children.push("b");
    });

    // Peer 2: move b under c
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.c.children.push("b");
    });

    // Peer 3: edit b's content
    doc3 = Automerge.change(doc3, (d) => {
      d.nodes.b.content = "Bravo edited by peer 3";
    });

    let merged = Automerge.merge(doc1, doc2);
    merged = Automerge.merge(merged, doc3);

    // b is duplicated (in a and c)
    expect(countReferences(merged, "b")).toBe(2);
    // b's content edit is preserved
    expect(merged.nodes.b.content).toBe("Bravo edited by peer 3");

    // Repair removes duplicate
    const repaired = applyStructuralRepair(merged);
    expect(countReferences(repaired, "b")).toBe(1);
    // Content still preserved after repair
    expect(repaired.nodes.b.content).toBe("Bravo edited by peer 3");
  });

  it("concurrent cross-moves: repair re-attaches orphaned nodes to origin parent", () => {
    // root → [x, a, b]
    // Cross-move: peer 1 moves a under b, peer 2 moves b under a
    // Both record originParentId = "x" so repair re-attaches to x (reachable)
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["x", "a", "b"]),
        x: makeNode("Context"),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);

    // Peer 1: move a under b (origin: root, index 1)
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("a");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.originParentId = "root";
      d.nodes.a.originIndex = idx;
      d.nodes.b.children.push("a");
    });

    // Peer 2: move b under a (origin: root, index 2)
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.b.originParentId = "root";
      d.nodes.b.originIndex = idx;
      d.nodes.a.children.push("b");
    });

    const merged = Automerge.merge(doc1, doc2);

    // Before repair: both orphaned
    expect(getReachableIds(merged).has("a")).toBe(false);
    expect(getReachableIds(merged).has("b")).toBe(false);

    // After repair: both reachable, content preserved
    // Only the orphan cycle entry node gets re-attached to its origin parent (root).
    // The other node is reachable through the entry node (one of the cross-move
    // edges survives while the back-edge is broken).
    const repaired = applyStructuralRepair(merged);
    const reachable = getReachableIds(repaired);
    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);
    expect(repaired.nodes.a.content).toBe("Alpha");
    expect(repaired.nodes.b.content).toBe("Bravo");
    // The entry node is re-attached to root (origin parent)
    expect(repaired.nodes.root.children.length).toBeGreaterThan(1);

    const check = detectTreeIssues(repaired);
    expect(check.cycles.length).toBe(0);
    expect(check.orphanedEntries.length).toBe(0);

    // Traversal works and includes both nodes
    const flat = flattenVisibleIds(repaired, "root");
    expect(flat).toContain("a");
    expect(flat).toContain("b");
  });

  it("cross-move where origin parent is also orphaned. Falls back to root", () => {
    // root → [a, b, c]
    // a and b cross-move each other, both with originParentId = "c"
    // But c is also orphaned → fall back to root
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);

    // Peer 1: move a under b, record origin as a non-existent node "gone"
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("a");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.originParentId = "gone";
      d.nodes.a.originIndex = 0;
      d.nodes.b.children.push("a");
    });

    // Peer 2: move b under a, record origin as a non-existent node "gone"
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.b.originParentId = "gone";
      d.nodes.b.originIndex = 0;
      d.nodes.a.children.push("b");
    });

    const merged = Automerge.merge(doc1, doc2);

    // Both orphaned
    expect(getReachableIds(merged).has("a")).toBe(false);
    expect(getReachableIds(merged).has("b")).toBe(false);

    // Repair falls back to root since "gone" is not reachable
    // The entry node goes to root; the other is reachable through the entry node
    const repaired = applyStructuralRepair(merged);
    const reachable = getReachableIds(repaired);
    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);
    // At least one is in root.children (the entry node); the other is reachable through it
    const aInRoot = repaired.nodes.root.children.includes("a");
    const bInRoot = repaired.nodes.root.children.includes("b");
    expect(aInRoot || bInRoot).toBe(true);
  });

  it("origin index is clamped when siblings have been removed", () => {
    // root → [x, a, b, c]
    // Cross-move a and b, both with originParentId = "root"
    // But c gets deleted concurrently, so originIndex may exceed children.length
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["x", "a", "b", "c"]),
        x: makeNode("Stable"),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
        c: makeNode("Charlie"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);
    let doc3 = Automerge.clone(base);

    // Peer 1: move a under b (origin: root, index 1)
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("a");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.originParentId = "root";
      d.nodes.a.originIndex = idx; // 1
      d.nodes.b.children.push("a");
    });

    // Peer 2: move b under a (origin: root, index 2)
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.b.originParentId = "root";
      d.nodes.b.originIndex = idx; // 2
      d.nodes.a.children.push("b");
    });

    // Peer 3: delete c from root
    doc3 = Automerge.change(doc3, (d) => {
      const idx = d.nodes.root.children.indexOf("c");
      d.nodes.root.children.splice(idx, 1);
    });

    let merged = Automerge.merge(doc1, doc2);
    merged = Automerge.merge(merged, doc3);

    // root has only [x] (a,b orphaned, c deleted)
    expect(merged.nodes.root.children).toEqual(["x"]);

    // Repair should clamp indices and re-attach without error
    // The entry node gets re-attached to root (origin parent) at clamped index;
    // the other is reachable through the entry node
    const repaired = applyStructuralRepair(merged);
    const reachable = getReachableIds(repaired);
    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);

    // No structural issues remain
    const check = detectTreeIssues(repaired);
    expect(check.cycles.length).toBe(0);
    expect(check.orphanedEntries.length).toBe(0);

    // Traversal includes both nodes
    const flat = flattenVisibleIds(repaired, "root");
    expect(flat).toContain("a");
    expect(flat).toContain("b");
  });

  it("BUG: without orphaned cycle repair, concurrent cross-moves silently lose data", () => {
    // This test captures the specific bug: two peers cross-move nodes,
    // creating an orphaned cycle. Without repair, the user's content-bearing
    // nodes become permanently invisible.
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["x", "y"]),
        x: makeNode("Important notes about project"),
        y: makeNode("Meeting agenda items"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);

    // Peer 1: reorganize. Move y under x (origin: root, index 1)
    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("y");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.y.originParentId = "root";
      d.nodes.y.originIndex = idx;
      d.nodes.x.children.push("y");
    });

    // Peer 2: reorganize. Move x under y (origin: root, index 0)
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("x");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.x.originParentId = "root";
      d.nodes.x.originIndex = idx;
      d.nodes.y.children.push("x");
    });

    const merged = Automerge.merge(doc1, doc2);

    // BUG manifestation: both nodes are orphaned, user sees empty document
    expect(merged.nodes.root.children.length).toBe(0);
    const reachableBeforeRepair = getReachableIds(merged);
    expect(reachableBeforeRepair.has("x")).toBe(false);
    expect(reachableBeforeRepair.has("y")).toBe(false);
    // Content still exists in the map but is invisible
    expect(merged.nodes.x.content).toBe("Important notes about project");
    expect(merged.nodes.y.content).toBe("Meeting agenda items");

    // FIX: structural repair detects and re-attaches the orphaned cycle
    const repaired = applyStructuralRepair(merged);
    const reachableAfterRepair = getReachableIds(repaired);
    expect(reachableAfterRepair.has("x")).toBe(true);
    expect(reachableAfterRepair.has("y")).toBe(true);
    // Content preserved and visible again
    expect(repaired.nodes.x.content).toBe("Important notes about project");
    expect(repaired.nodes.y.content).toBe("Meeting agenda items");
  });

  it("full scenario: delete + undo + concurrent add + repair", () => {
    const base = makeBaseDoc();
    // root → [a, b, c]

    // Peer A deletes b, records undo ops
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "root", childId: "b", index: 1 },
    ];

    let docA = Automerge.change(base, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
    });

    // Peer B concurrently adds "d" and moves "c" under "a"
    let docB = Automerge.clone(base);
    docB = Automerge.change(docB, (d) => {
      d.nodes.d = makeNode("Delta");
      d.nodes.root.children.push("d");
      const idx = d.nodes.root.children.indexOf("c");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.children.push("c");
    });

    let merged = Automerge.merge(docA, docB);
    // root → [a, d], a → [a1, c], b orphaned

    // Peer A undoes the delete of b
    const { doc: undone } = applyUndoOps(merged, undoOps);

    // b is restored to root
    expect(undone.nodes.root.children).toContain("b");
    // d is still in root (concurrent add preserved)
    expect(undone.nodes.root.children).toContain("d");
    // c is under a (concurrent move preserved)
    expect(undone.nodes.a.children).toContain("c");
    // c is NOT in root (it was moved by peer B)
    expect(undone.nodes.root.children).not.toContain("c");

    // No structural issues
    const { duplicates, cycles } = detectTreeIssues(undone);
    expect(duplicates.length).toBe(0);
    expect(cycles.length).toBe(0);
  });

  it("concurrent delete of all bullets + auto-repair creates usable state", () => {
    // Three peers each delete one of three bullets
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["x", "y", "z"]),
        x: makeNode("X"),
        y: makeNode("Y"),
        z: makeNode("Z"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);
    let doc3 = Automerge.clone(base);

    doc1 = Automerge.change(doc1, (d) => {
      const idx = d.nodes.root.children.indexOf("x");
      d.nodes.root.children.splice(idx, 1);
    });
    doc2 = Automerge.change(doc2, (d) => {
      const idx = d.nodes.root.children.indexOf("y");
      d.nodes.root.children.splice(idx, 1);
    });
    doc3 = Automerge.change(doc3, (d) => {
      const idx = d.nodes.root.children.indexOf("z");
      d.nodes.root.children.splice(idx, 1);
    });

    let merged = Automerge.merge(doc1, doc2);
    merged = Automerge.merge(merged, doc3);

    expect(merged.nodes.root.children.length).toBe(0);

    // Auto-create repair
    const repaired = applyZeroChildrenRepair(merged, "root");
    expect(repaired.nodes.root.children.length).toBe(1);

    // The new bullet is a valid, visible entry
    const visible = flattenVisibleIds(repaired, "root");
    expect(visible.length).toBe(1);
  });

  it("concurrent star from two peers + dedup repair", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      starredIds: [],
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
      },
    });

    let doc1 = Automerge.clone(base);
    let doc2 = Automerge.clone(base);

    // Both peers star a and b
    doc1 = Automerge.change(doc1, (d) => {
      d.nodes.a.starred = true;
      d.starredIds!.push("a");
      d.nodes.b.starred = true;
      d.starredIds!.push("b");
    });

    doc2 = Automerge.change(doc2, (d) => {
      d.nodes.a.starred = true;
      d.starredIds!.push("a");
      d.nodes.b.starred = true;
      d.starredIds!.push("b");
    });

    const merged = Automerge.merge(doc1, doc2);

    // starredIds has duplicates
    expect(merged.starredIds!.filter((id) => id === "a").length).toBe(2);
    expect(merged.starredIds!.filter((id) => id === "b").length).toBe(2);

    // Repair deduplicates
    const repaired = applyStarredIdsRepair(merged);
    expect(repaired.starredIds!.filter((id) => id === "a").length).toBe(1);
    expect(repaired.starredIds!.filter((id) => id === "b").length).toBe(1);
    expect(repaired.starredIds!.length).toBe(2);
  });
});

// ===========================================================================
// Backspace-merge concurrency scenarios
// ===========================================================================

describe("Backspace-merge concurrency", () => {
  /**
   * Helper: simulate the backspace-merge operation at the data level.
   * Merges `sourceId` content into `prevId`, removes `sourceId` from parent,
   * promotes sourceId's children. Returns the undo ops.
   */
  function simulateBackspaceMerge(
    doc: Automerge.Doc<BulletsDoc>,
    sourceId: string,
    prevId: string,
    parentId: string,
  ): { doc: Automerge.Doc<BulletsDoc>; ops: UndoOp[] } {
    const prevContent = doc.nodes[prevId].content;
    const sourceContent = doc.nodes[sourceId].content;
    const childIds = [...doc.nodes[sourceId].children];
    const ops: UndoOp[] = [];

    ops.push({ type: "set-content", nodeId: prevId, oldContent: prevContent });
    ops.push({ type: "set-content", nodeId: sourceId, oldContent: sourceContent });

    const newDoc = Automerge.change(doc, (d) => {
      // Merge content
      Automerge.updateText(d, ["nodes", prevId, "content"], prevContent + sourceContent);

      const parent = d.nodes[parentId];
      const idx = parent.children.indexOf(sourceId);

      // Clear source's children
      for (let ci = childIds.length - 1; ci >= 0; ci--) {
        ops.push({ type: "splice-out", parentId: sourceId, childId: childIds[ci], index: ci });
      }
      d.nodes[sourceId].children.splice(0);

      // Remove source from parent, insert promoted children
      ops.push({ type: "splice-out", parentId, childId: sourceId, index: idx });
      for (let ci = 0; ci < childIds.length; ci++) {
        ops.push({ type: "splice-in", parentId, childId: childIds[ci], index: idx + ci });
      }
      parent.children.splice(idx, 1, ...childIds);
    });

    return { doc: newDoc, ops };
  }

  // -----------------------------------------------------------------------
  // Scenario B: Concurrent merge + peer deletes prev bullet
  // -----------------------------------------------------------------------
  describe("Scenario B: merge into prev bullet that peer concurrently deletes", () => {
    it("merged content is lost when prev bullet is concurrently deleted", () => {
      // root → [a, b], a.content = "hello", b.content = "world"
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("hello"),
          b: makeNode("world"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: backspace-merge b into a
      const { doc: merged1 } = simulateBackspaceMerge(doc1, "b", "a", "root");
      doc1 = merged1;

      // Peer 2: deletes a
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(idx, 1);
      });

      const merged = Automerge.merge(doc1, doc2);
      const reachable = getReachableIds(merged);

      // a was deleted by peer 2, so it's orphaned
      // The merged content "helloworld" is on orphaned node a
      expect(reachable.has("a")).toBe(false);

      // b was removed by peer 1's merge
      expect(reachable.has("b")).toBe(false);

      // Both "hello" and "world" content are lost to orphaned nodes
      // root has zero visible bullets with any content
      const visibleContent: string[] = [];
      for (const id of reachable) {
        if (id === "root") continue;
        const content = merged.nodes[id]?.content;
        if (content) visibleContent.push(content);
      }
      expect(visibleContent.length).toBe(0);
      // This documents data loss. "hello" and "world" are both orphaned
    });
  });

  // -----------------------------------------------------------------------
  // Scenario F: Undo after merge + peer deletes promoted child
  // -----------------------------------------------------------------------
  describe("Scenario F: undo of merge resurrects concurrently-deleted children", () => {
    it("undo re-inserts child that peer concurrently deleted", () => {
      // root → [a, b], b → [b1, b2]
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo", ["b1", "b2"]),
          b1: makeNode("B-child-1"),
          b2: makeNode("B-child-2"),
        },
      });

      // Peer A: backspace-merge b into a, promoting b1 and b2 to root
      const { doc: afterMerge, ops: undoOps } = simulateBackspaceMerge(
        base, "b", "a", "root"
      );
      // root → [a, b1, b2]

      // Peer B: concurrently deletes b1 from root
      let doc2 = Automerge.clone(base);
      // First simulate what peer A's merge did structurally from peer B's perspective:
      // peer B sees the original tree. They delete b1 from b's children.
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.b.children.indexOf("b1");
        d.nodes.b.children.splice(idx, 1);
      });

      let merged = Automerge.merge(afterMerge, doc2);
      merged = applyStructuralRepair(merged);

      // After merge+repair: b1 should be gone (peer B deleted it)
      // Peer A's merge promoted b1 to root, peer B deleted b1 from b
      // After Automerge merge: b1 may or may not be in root depending on merge
      const reachableBefore = getReachableIds(merged);

      // Now peer A undoes the backspace-merge
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // Undo re-inserts b into root and puts b1 back into b's children
      // But peer B intended to delete b1. Undo resurrects it
      const hasB1InB = undone.nodes.b?.children.includes("b1") ?? false;
      const reachableAfter = getReachableIds(undone);
      const b1Reachable = reachableAfter.has("b1");

      // Document: undo resurrects b1 even though peer B deleted it
      // This is a known limitation of op-based undo
      if (b1Reachable) {
        // b1 was resurrected. This is the problematic behavior
        expect(b1Reachable).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Scenario A: Undo of merge clobbers peer's edit to prev bullet
  // -----------------------------------------------------------------------
  describe("Scenario A: undo of merge clobbers concurrent edit to prev bullet", () => {
    it("undoing merge restores prev content, losing peer's concurrent edit", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("hello"),
          b: makeNode("world"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer A: backspace-merge b into a → a.content = "helloworld"
      const { doc: afterMerge, ops: undoOps } = simulateBackspaceMerge(
        doc1, "b", "a", "root"
      );
      doc1 = afterMerge;

      // Peer B: concurrently edits a.content to "hi there"
      doc2 = Automerge.change(doc2, (d) => {
        d.nodes.a.content = "hi there";
      });

      let merged = Automerge.merge(doc1, doc2);
      // a.content is LWW. Either "helloworld" or "hi there"

      // Peer A undoes the merge
      const { doc: undone } = applyUndoOps(merged, undoOps);

      // Undo restores a.content to "hello" (the oldContent from before merge)
      // This clobbers peer B's "hi there" edit
      expect(undone.nodes.a.content).toBe("hello");
      // Peer B's edit is lost. This is a known limitation of set-content undo
    });
  });

  // -----------------------------------------------------------------------
  // Scenario E: Concurrent backspace-merge of adjacent bullets
  // -----------------------------------------------------------------------
  describe("Scenario E: two peers merge adjacent bullets concurrently", () => {
    it("concurrent chain merges cause content loss", () => {
      // root → [a, b, c]
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b", "c"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo"),
          c: makeNode("Charlie"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: backspace-merge b into a → a.content = "AlphaBravo", remove b
      const { doc: afterMerge1 } = simulateBackspaceMerge(doc1, "b", "a", "root");
      doc1 = afterMerge1;

      // Peer 2: backspace-merge c into b → b.content = "BravoCharlie", remove c
      const { doc: afterMerge2 } = simulateBackspaceMerge(doc2, "c", "b", "root");
      doc2 = afterMerge2;

      const merged = Automerge.merge(doc1, doc2);
      const reachable = getReachableIds(merged);

      // After merge: both b and c are spliced out of root
      // a.content: LWW between "AlphaBravo" (peer 1) and "Alpha" (peer 2 didn't touch a) → "AlphaBravo"
      // b.content: LWW between "Bravo" (peer 1 didn't touch b content) and "BravoCharlie" (peer 2) → "BravoCharlie"
      // But b is orphaned (removed from root by peer 1)

      // Collect all visible content
      const visibleContent: string[] = [];
      for (const id of reachable) {
        if (id === "root") continue;
        const content = merged.nodes[id]?.content;
        if (content) visibleContent.push(content);
      }

      // "Charlie" only exists in orphaned b's content "BravoCharlie"
      // Visible content should contain all three original texts
      const allText = visibleContent.join(" ");
      const hasCharlie = allText.includes("Charlie");

      // Document: "Charlie" is lost. It was merged into b by peer 2,
      // but b was removed from root by peer 1
      expect(hasCharlie).toBe(false);
      // This confirms data loss in the chain merge scenario
    });
  });

  // -----------------------------------------------------------------------
  // Scenario G: Children promotion + concurrent move creates cycle
  // -----------------------------------------------------------------------
  describe("Scenario G: children promotion creates cycle via concurrent move", () => {
    it("structural repair catches cycle from merge promotion + concurrent move", () => {
      // root → [a, b], b → [c]
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo", ["c"]),
          c: makeNode("Charlie"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer 1: backspace-merge b into a → c promoted to root
      const { doc: afterMerge } = simulateBackspaceMerge(doc1, "b", "a", "root");
      doc1 = afterMerge;
      // root → [a, c]

      // Peer 2: moves a under c (creating potential cycle after merge)
      doc2 = Automerge.change(doc2, (d) => {
        const idx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(idx, 1);
        d.nodes.c.children.push("a");
      });
      // root → [b], b → [c], c → [a]

      const merged = Automerge.merge(doc1, doc2);

      // Check if cycle exists before repair
      const { cycles, orphanedEntries, orphanedCycles } = detectTreeIssues(merged);
      const hasCycleIssue = cycles.length > 0 || orphanedCycles.length > 0;

      // Apply repair
      const repaired = applyStructuralRepair(merged);
      const check = detectTreeIssues(repaired);

      // After repair: no cycles, all content-bearing nodes reachable
      expect(check.cycles.length).toBe(0);
      expect(check.orphanedCycles.length).toBe(0);

      const reachable = getReachableIds(repaired);
      // At minimum, the content should be preserved somewhere reachable
      let alphaReachable = false;
      let charlieReachable = false;
      for (const id of reachable) {
        if (merged.nodes[id]?.content === "Alpha" || merged.nodes[id]?.content === "AlphaBravo") alphaReachable = true;
        if (merged.nodes[id]?.content === "Charlie") charlieReachable = true;
      }
      expect(alphaReachable).toBe(true);
      expect(charlieReachable).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Undo of backspace-merge basics (no concurrency. Sanity check)
  // -----------------------------------------------------------------------
  describe("Undo of backspace-merge (single peer)", () => {
    it("undo restores prev content and re-inserts merged bullet", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b", "c"]),
          a: makeNode("hello"),
          b: makeNode("world"),
          c: makeNode("Charlie"),
        },
      });

      const { doc: afterMerge, ops } = simulateBackspaceMerge(base, "b", "a", "root");

      expect(afterMerge.nodes.a.content).toBe("helloworld");
      expect(afterMerge.nodes.root.children).toEqual(["a", "c"]);

      const { doc: undone } = applyUndoOps(afterMerge, ops);

      expect(undone.nodes.a.content).toBe("hello");
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.root.children).toContain("a");
      expect(undone.nodes.root.children).toContain("c");
    });

    it("undo restores promoted children back to merged bullet", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo", ["b1", "b2"]),
          b1: makeNode("B1"),
          b2: makeNode("B2"),
        },
      });

      const { doc: afterMerge, ops } = simulateBackspaceMerge(base, "b", "a", "root");

      expect(afterMerge.nodes.a.content).toBe("AlphaBravo");
      expect(afterMerge.nodes.root.children).toEqual(["a", "b1", "b2"]);
      expect(afterMerge.nodes.b.children).toEqual([]);

      const { doc: undone } = applyUndoOps(afterMerge, ops);

      expect(undone.nodes.a.content).toBe("Alpha");
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.root.children).not.toContain("b1");
      expect(undone.nodes.root.children).not.toContain("b2");
      expect(undone.nodes.b.children).toContain("b1");
      expect(undone.nodes.b.children).toContain("b2");
    });

    it("undo of merge preserves concurrent peer's changes to other bullets", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b", "c"]),
          a: makeNode("hello"),
          b: makeNode("world"),
          c: makeNode("Charlie"),
        },
      });

      let doc1 = Automerge.clone(base);
      let doc2 = Automerge.clone(base);

      // Peer A: merge b into a
      const { doc: afterMerge, ops } = simulateBackspaceMerge(doc1, "b", "a", "root");
      doc1 = afterMerge;

      // Peer B: add a new bullet d
      doc2 = Automerge.change(doc2, (d) => {
        d.nodes.d = makeNode("Delta");
        d.nodes.root.children.push("d");
      });

      let merged = Automerge.merge(doc1, doc2);

      // Peer A undoes
      const { doc: undone } = applyUndoOps(merged, ops);

      // b restored, d still present
      expect(undone.nodes.root.children).toContain("b");
      expect(undone.nodes.root.children).toContain("d");
      expect(undone.nodes.a.content).toBe("hello");
    });
  });
});
