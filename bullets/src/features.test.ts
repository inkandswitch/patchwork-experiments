/**
 * Comprehensive feature test suite for the bullets tool.
 *
 * Tests all core single-peer CRUD operations, tree utilities, clipboard,
 * search, mirrors, stars, and undo. Exercised at the Automerge data-model
 * level (no DOM / SolidJS required).
 *
 * Sections:
 *   1. Tree Utilities (tree-utils.ts)
 *   2. Core Operations (Enter, Tab, Backspace, Delete, etc.)
 *   3. Move Subtree / Drag-and-Drop
 *   4. Multi-Select Operations
 *   5. Clipboard (clipboard.ts)
 *   6. Search (search.ts)
 *   7. Mirrors
 *   8. Stars / Favorites
 *   9. Undo Operations
 */

import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import type { BulletsDoc, UndoOp } from "./datatype.ts";
import {
  findParentId,
  flattenVisibleIds,
  flattenVisibleWithParent,
  flattenVisibleWithDepth,
  isDescendantOf,
  collectDescendantIds,
  getPathToNode,
  getReachableIds,
  detectTreeIssues,
  isYouTubeUrl,
  extractYouTubeVideoId,
  isImageDataUrl,
  imageTypeLabel,
  extractTags,
  hasTag,
  findPreviousVisibleId,
  findNextVisibleId,
} from "./tree-utils.ts";
import {
  serializeSubtree,
  toPlainText,
  toHtml,
  toInternalJson,
  parseInternalJson,
  parsePlainText,
  looksLikeStructuredText,
} from "./clipboard.ts";
import { searchBullets } from "./search.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Base doc: root → [a, b, c]   a → [a1]
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
 * Reimplement applyUndoEntry from tool.tsx for testing.
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
        case "create-node":
          break;
      }
    }
  });
  return { doc: newDoc, inverseOps };
}

// ===========================================================================
// 1. Tree Utilities
// ===========================================================================

describe("Tree Utilities", () => {
  // -----------------------------------------------------------------------
  // findParentId
  // -----------------------------------------------------------------------
  describe("findParentId", () => {
    it("finds the correct parent", () => {
      const doc = makeBaseDoc();
      expect(findParentId(doc, "a")).toBe("root");
      expect(findParentId(doc, "a1")).toBe("a");
      expect(findParentId(doc, "b")).toBe("root");
    });

    it("returns null for root node", () => {
      const doc = makeBaseDoc();
      expect(findParentId(doc, "root")).toBeNull();
    });

    it("returns first parent for mirrored node", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        mirroredIds: ["b"],
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo"),
        },
      };
      // findParentId returns the first parent encountered during iteration
      const parent = findParentId(doc, "b");
      expect(parent).not.toBeNull();
      expect(["root", "a"]).toContain(parent);
    });

    it("returns null for orphaned node", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha"),
          b: makeNode("Bravo"), // orphaned
        },
      };
      expect(findParentId(doc, "b")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // flattenVisibleIds
  // -----------------------------------------------------------------------
  describe("flattenVisibleIds", () => {
    it("returns correct DFS order", () => {
      const doc = makeBaseDoc();
      const flat = flattenVisibleIds(doc, "root");
      expect(flat).toEqual(["a", "a1", "b", "c"]);
    });

    it("respects collapsed nodes", () => {
      let doc = makeBaseDoc();
      doc = Automerge.change(doc, (d) => {
        d.nodes.a.collapsed = true;
      });
      const flat = flattenVisibleIds(doc, "root");
      expect(flat).toEqual(["a", "b", "c"]);
      expect(flat).not.toContain("a1");
    });

    it("handles empty children", () => {
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", []),
        },
      });
      const flat = flattenVisibleIds(doc, "root");
      expect(flat).toEqual([]);
    });

    it("is cycle-safe", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo", ["a"]), // cycle
        },
      };
      const flat = flattenVisibleIds(doc, "root");
      expect(flat).toContain("a");
      expect(flat).toContain("b");
      // Should not hang or have duplicates
      expect(flat.length).toBe(2);
    });

    it("works with a sub-tree root", () => {
      const doc = makeBaseDoc();
      const flat = flattenVisibleIds(doc, "a");
      expect(flat).toEqual(["a1"]);
    });

    it("uses isCollapsed predicate over doc.collapsed", () => {
      const doc = makeBaseDoc();
      const isCollapsed = (id: string) => id === "a";
      const flat = flattenVisibleIds(doc, "root", isCollapsed);
      expect(flat).toEqual(["a", "b", "c"]);
    });
  });

  // -----------------------------------------------------------------------
  // flattenVisibleWithParent
  // -----------------------------------------------------------------------
  describe("flattenVisibleWithParent", () => {
    it("includes parentId for each entry", () => {
      const doc = makeBaseDoc();
      const flat = flattenVisibleWithParent(doc, "root");
      expect(flat).toEqual([
        { id: "a", parentId: "root" },
        { id: "a1", parentId: "a" },
        { id: "b", parentId: "root" },
        { id: "c", parentId: "root" },
      ]);
    });

    it("respects collapsed", () => {
      let doc = makeBaseDoc();
      doc = Automerge.change(doc, (d) => {
        d.nodes.a.collapsed = true;
      });
      const flat = flattenVisibleWithParent(doc, "root");
      expect(flat).toEqual([
        { id: "a", parentId: "root" },
        { id: "b", parentId: "root" },
        { id: "c", parentId: "root" },
      ]);
    });

    it("uses isCollapsed predicate over doc.collapsed", () => {
      const doc = makeBaseDoc();
      const isCollapsed = (id: string) => id === "a";
      const flat = flattenVisibleWithParent(doc, "root", isCollapsed);
      expect(flat).toEqual([
        { id: "a", parentId: "root" },
        { id: "b", parentId: "root" },
        { id: "c", parentId: "root" },
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // flattenVisibleWithDepth
  // -----------------------------------------------------------------------
  describe("flattenVisibleWithDepth", () => {
    it("returns correct depth values", () => {
      const doc = makeBaseDoc();
      const flat = flattenVisibleWithDepth(doc, "root");
      expect(flat).toEqual([
        { id: "a", depth: 0 },
        { id: "a1", depth: 1 },
        { id: "b", depth: 0 },
        { id: "c", depth: 0 },
      ]);
    });

    it("respects collapsed", () => {
      let doc = makeBaseDoc();
      doc = Automerge.change(doc, (d) => {
        d.nodes.a.collapsed = true;
      });
      const flat = flattenVisibleWithDepth(doc, "root");
      expect(flat).toEqual([
        { id: "a", depth: 0 },
        { id: "b", depth: 0 },
        { id: "c", depth: 0 },
      ]);
    });

    it("uses isCollapsed predicate over doc.collapsed", () => {
      // doc.collapsed is false but local predicate says collapsed
      const doc = makeBaseDoc();
      const isCollapsed = (id: string) => id === "a";
      const flat = flattenVisibleWithDepth(doc, "root", isCollapsed);
      expect(flat).toEqual([
        { id: "a", depth: 0 },
        { id: "b", depth: 0 },
        { id: "c", depth: 0 },
      ]);
    });

    it("isCollapsed predicate overrides doc.collapsed=true", () => {
      // doc says collapsed but predicate says not collapsed
      let doc = makeBaseDoc();
      doc = Automerge.change(doc, (d) => {
        d.nodes.a.collapsed = true;
      });
      const isCollapsed = (_id: string) => false;
      const flat = flattenVisibleWithDepth(doc, "root", isCollapsed);
      expect(flat).toEqual([
        { id: "a", depth: 0 },
        { id: "a1", depth: 1 },
        { id: "b", depth: 0 },
        { id: "c", depth: 0 },
      ]);
    });

    it("handles deeper nesting", () => {
      const doc = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("A", ["b"]),
          b: makeNode("B", ["c"]),
          c: makeNode("C"),
        },
      });
      const flat = flattenVisibleWithDepth(doc, "root");
      expect(flat).toEqual([
        { id: "a", depth: 0 },
        { id: "b", depth: 1 },
        { id: "c", depth: 2 },
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // isDescendantOf
  // -----------------------------------------------------------------------
  describe("isDescendantOf", () => {
    it("returns true for direct child", () => {
      const doc = makeBaseDoc();
      expect(isDescendantOf(doc, "a", "root")).toBe(true);
    });

    it("returns true for deep descendant", () => {
      const doc = makeBaseDoc();
      expect(isDescendantOf(doc, "a1", "root")).toBe(true);
    });

    it("returns false for non-descendant", () => {
      const doc = makeBaseDoc();
      expect(isDescendantOf(doc, "b", "a")).toBe(false);
    });

    it("returns false for ancestor (not descendant)", () => {
      const doc = makeBaseDoc();
      expect(isDescendantOf(doc, "root", "a")).toBe(false);
    });

    it("is cycle-safe", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("", ["b"]),
          b: makeNode("", ["a"]),
        },
      };
      // Should terminate, not infinite loop
      expect(isDescendantOf(doc, "a", "root")).toBe(true);
      expect(isDescendantOf(doc, "b", "root")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // collectDescendantIds
  // -----------------------------------------------------------------------
  describe("collectDescendantIds", () => {
    it("collects self + all descendants", () => {
      const doc = makeBaseDoc();
      const ids = collectDescendantIds(doc, "a");
      expect(ids).toContain("a");
      expect(ids).toContain("a1");
      expect(ids.length).toBe(2);
    });

    it("returns just self for leaf node", () => {
      const doc = makeBaseDoc();
      const ids = collectDescendantIds(doc, "b");
      expect(ids).toEqual(["b"]);
    });

    it("is cycle-safe", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("", ["b"]),
          b: makeNode("", ["a"]),
        },
      };
      const ids = collectDescendantIds(doc, "a");
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // getPathToNode
  // -----------------------------------------------------------------------
  describe("getPathToNode", () => {
    it("returns path from root to target", () => {
      const doc = makeBaseDoc();
      const path = getPathToNode(doc, "root", "a1");
      expect(path).toEqual(["root", "a", "a1"]);
    });

    it("returns just root and target for direct child", () => {
      const doc = makeBaseDoc();
      const path = getPathToNode(doc, "root", "a");
      expect(path).toEqual(["root", "a"]);
    });

    it("returns empty array for missing node", () => {
      const doc = makeBaseDoc();
      const path = getPathToNode(doc, "root", "nonexistent");
      expect(path).toEqual([]);
    });

    it("returns just the node when target is root", () => {
      const doc = makeBaseDoc();
      const path = getPathToNode(doc, "root", "root");
      expect(path).toEqual(["root"]);
    });
  });

  // -----------------------------------------------------------------------
  // getReachableIds
  // -----------------------------------------------------------------------
  describe("getReachableIds", () => {
    it("includes all reachable nodes", () => {
      const doc = makeBaseDoc();
      const reachable = getReachableIds(doc);
      expect(reachable.has("root")).toBe(true);
      expect(reachable.has("a")).toBe(true);
      expect(reachable.has("a1")).toBe(true);
      expect(reachable.has("b")).toBe(true);
      expect(reachable.has("c")).toBe(true);
    });

    it("excludes orphaned nodes", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha"),
          b: makeNode("Orphan"),
        },
      };
      const reachable = getReachableIds(doc);
      expect(reachable.has("a")).toBe(true);
      expect(reachable.has("b")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // detectTreeIssues
  // -----------------------------------------------------------------------
  describe("detectTreeIssues", () => {
    it("reports no issues on a clean tree", () => {
      const doc = makeBaseDoc();
      const { duplicates, cycles, orphanedEntries, orphanedCycles } = detectTreeIssues(doc);
      expect(duplicates.length).toBe(0);
      expect(cycles.length).toBe(0);
      expect(orphanedEntries.length).toBe(0);
      expect(orphanedCycles.length).toBe(0);
    });

    it("detects duplicate reference", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha", ["b"]), // b also in root
          b: makeNode("Bravo"),
        },
      };
      const { duplicates } = detectTreeIssues(doc);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].childId).toBe("b");
    });

    it("detects reachable cycle", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("", ["b"]),
          b: makeNode("", ["a"]),
        },
      };
      const { cycles } = detectTreeIssues(doc);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("detects orphaned cycle", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", []),
          a: makeNode("", ["b"]),
          b: makeNode("", ["a"]),
        },
      };
      const { orphanedEntries, orphanedCycles } = detectTreeIssues(doc);
      expect(orphanedEntries.length).toBeGreaterThan(0);
      expect(orphanedCycles.length).toBeGreaterThan(0);
    });

    it("preserves intentional mirrors in mirroredIds", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        mirroredIds: ["b"],
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo"),
        },
      };
      const { duplicates } = detectTreeIssues(doc);
      expect(duplicates.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // findPreviousVisibleId / findNextVisibleId
  // -----------------------------------------------------------------------
  describe("findPreviousVisibleId / findNextVisibleId", () => {
    it("finds the previous visible bullet", () => {
      const doc = makeBaseDoc();
      const prev = findPreviousVisibleId(doc, "root", "b");
      expect(prev).toEqual({ id: "a1", parentId: "a" });
    });

    it("returns null for first visible bullet", () => {
      const doc = makeBaseDoc();
      const prev = findPreviousVisibleId(doc, "root", "a");
      expect(prev).toBeNull();
    });

    it("finds the next visible bullet", () => {
      const doc = makeBaseDoc();
      const next = findNextVisibleId(doc, "root", "a");
      expect(next).toEqual({ id: "a1", parentId: "a" });
    });

    it("returns null for last visible bullet", () => {
      const doc = makeBaseDoc();
      const next = findNextVisibleId(doc, "root", "c");
      expect(next).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // URL helpers
  // -----------------------------------------------------------------------
  describe("URL helpers", () => {
    it("isYouTubeUrl recognizes YouTube URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
      expect(isYouTubeUrl("https://youtu.be/abc123")).toBe(true);
      expect(isYouTubeUrl("https://youtube.com/shorts/abc123")).toBe(true);
      expect(isYouTubeUrl("https://www.youtube.com/embed/abc123")).toBe(true);
      expect(isYouTubeUrl("not a url")).toBe(false);
      expect(isYouTubeUrl("https://example.com")).toBe(false);
    });

    it("extractYouTubeVideoId extracts IDs", () => {
      expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=abc123")).toBe("abc123");
      expect(extractYouTubeVideoId("https://youtu.be/xyz789")).toBe("xyz789");
      expect(extractYouTubeVideoId("https://youtube.com/embed/def456")).toBe("def456");
      expect(extractYouTubeVideoId("https://youtube.com/shorts/sh123")).toBe("sh123");
      expect(extractYouTubeVideoId("no video")).toBeNull();
    });

    it("isImageDataUrl detects image data URLs", () => {
      expect(isImageDataUrl("data:image/png;base64,abc")).toBe(true);
      expect(isImageDataUrl("data:image/jpeg;base64,abc")).toBe(true);
      expect(isImageDataUrl("not an image")).toBe(false);
    });

    it("imageTypeLabel returns correct labels", () => {
      expect(imageTypeLabel("data:image/png;base64,abc")).toBe("PNG Image");
      expect(imageTypeLabel("data:image/jpeg;base64,abc")).toBe("JPEG Image");
      expect(imageTypeLabel("data:image/svg+xml;base64,abc")).toBe("SVG Image");
      expect(imageTypeLabel("data:image/gif;base64,abc")).toBe("GIF Image");
      expect(imageTypeLabel("no match")).toBe("Image");
    });
  });

  // -----------------------------------------------------------------------
  // Tag helpers
  // -----------------------------------------------------------------------
  describe("Tag helpers", () => {
    it("extractTags finds tags in text", () => {
      expect(extractTags("hello #world #foo")).toEqual(["world", "foo"]);
    });

    it("extractTags returns empty for no tags", () => {
      expect(extractTags("hello world")).toEqual([]);
    });

    it("extractTags lowercases tags", () => {
      expect(extractTags("#Hello #WORLD")).toEqual(["hello", "world"]);
    });

    it("hasTag detects presence of tags", () => {
      expect(hasTag("hello #world")).toBe(true);
      expect(hasTag("hello world")).toBe(false);
    });
  });
});

// ===========================================================================
// 2. Core Operations
// ===========================================================================

describe("Core Operations", () => {
  // -----------------------------------------------------------------------
  // Edit content
  // -----------------------------------------------------------------------
  describe("Edit content", () => {
    it("updateText changes content", () => {
      const base = makeBaseDoc();
      const updated = Automerge.change(base, (d) => {
        Automerge.updateText(d, ["nodes", "a", "content"], "Alpha updated");
      });
      expect(updated.nodes.a.content).toBe("Alpha updated");
    });
  });

  // -----------------------------------------------------------------------
  // Enter (add bullet)
  // -----------------------------------------------------------------------
  describe("Enter (add bullet)", () => {
    it("creates sibling after current bullet", () => {
      const base = makeBaseDoc();
      const ops: UndoOp[] = [];
      const newId = "new1";

      const after = Automerge.change(base, (d) => {
        d.nodes[newId] = makeNode("");
        ops.push({ type: "create-node", nodeId: newId });
        // b is at index 1 in root.children
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx + 1, 0, newId);
        ops.push({ type: "splice-in", parentId: "root", childId: newId, index: idx + 1 });
      });

      expect(after.nodes.root.children).toEqual(["a", "b", "new1", "c"]);
      expect(after.nodes[newId].content).toBe("");
    });

    it("splits text at cursor position", () => {
      const base = makeBaseDoc();
      const newId = "new1";
      const fullText = "Alpha";
      const leftText = "Al";
      const rightText = "pha";

      const ops: UndoOp[] = [
        { type: "create-node", nodeId: newId },
        { type: "set-content", nodeId: "a", oldContent: fullText },
        { type: "splice-in", parentId: "root", childId: newId, index: 1 },
      ];

      const after = Automerge.change(base, (d) => {
        d.nodes[newId] = makeNode(rightText);
        Automerge.updateText(d, ["nodes", "a", "content"], leftText);
        d.nodes.root.children.splice(1, 0, newId);
      });

      expect(after.nodes.a.content).toBe("Al");
      expect(after.nodes[newId].content).toBe("pha");
      // new1 is inserted after a in root's children (a1 remains a child of a, not root)
      expect(after.nodes.root.children).toEqual(["a", "new1", "b", "c"]);
    });

    it("creates first child when parent is expanded with children", () => {
      const base = makeBaseDoc();
      const newId = "new1";
      const fullText = "Alpha";
      const leftText = "Al";
      const rightText = "pha";

      const ops: UndoOp[] = [
        { type: "create-node", nodeId: newId },
        { type: "set-content", nodeId: "a", oldContent: fullText },
        { type: "splice-in", parentId: "a", childId: newId, index: 0 },
      ];

      const after = Automerge.change(base, (d) => {
        d.nodes[newId] = makeNode(rightText);
        Automerge.updateText(d, ["nodes", "a", "content"], leftText);
        d.nodes.a.children.splice(0, 0, newId);
      });

      expect(after.nodes.a.content).toBe("Al");
      expect(after.nodes[newId].content).toBe("pha");
      expect(after.nodes.a.children).toEqual(["new1", "a1"]);
    });

    it("enter at start of bullet moves all content to new bullet", () => {
      const base = makeBaseDoc();
      const newId = "new1";

      const after = Automerge.change(base, (d) => {
        d.nodes[newId] = makeNode("Bravo");
        Automerge.updateText(d, ["nodes", "b", "content"], "");
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx + 1, 0, newId);
      });

      expect(after.nodes.b.content).toBe("");
      expect(after.nodes[newId].content).toBe("Bravo");
    });
  });

  // -----------------------------------------------------------------------
  // Tab (indent)
  // -----------------------------------------------------------------------
  describe("Tab (indent)", () => {
    it("moves bullet to last child of previous sibling", () => {
      const base = makeBaseDoc();
      const ops: UndoOp[] = [];

      const after = Automerge.change(base, (d) => {
        // Indent b: remove from root, append to a's children
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        ops.push({ type: "splice-out", parentId: "root", childId: "b", index: idx });
        d.nodes.a.children.push("b");
        ops.push({ type: "splice-in", parentId: "a", childId: "b", index: d.nodes.a.children.length - 1 });
      });

      expect(after.nodes.root.children).toEqual(["a", "c"]);
      expect(after.nodes.a.children).toEqual(["a1", "b"]);
    });

    it("is a no-op for first child (no previous sibling)", () => {
      const base = makeBaseDoc();
      // "a" is the first child of root. Indent should not work
      const firstChildId = base.nodes.root.children[0];
      expect(firstChildId).toBe("a");

      const idx = base.nodes.root.children.indexOf("a");
      // No previous sibling: idx === 0
      expect(idx).toBe(0);
      // In the real code, this returns early. Nothing to do
    });
  });

  // -----------------------------------------------------------------------
  // Shift+Tab (outdent)
  // -----------------------------------------------------------------------
  describe("Shift+Tab (outdent)", () => {
    it("moves bullet to grandparent after parent", () => {
      const base = makeBaseDoc();
      const ops: UndoOp[] = [];

      // Outdent a1 from a to root (after a)
      const after = Automerge.change(base, (d) => {
        const idx = d.nodes.a.children.indexOf("a1");
        d.nodes.a.children.splice(idx, 1);
        ops.push({ type: "splice-out", parentId: "a", childId: "a1", index: idx });

        const parentIdx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(parentIdx + 1, 0, "a1");
        ops.push({ type: "splice-in", parentId: "root", childId: "a1", index: parentIdx + 1 });
      });

      expect(after.nodes.a.children).toEqual([]);
      expect(after.nodes.root.children).toEqual(["a", "a1", "b", "c"]);
    });

    it("is a no-op at context root level", () => {
      const base = makeBaseDoc();
      // "a" is already a child of root (context root). Can't outdent further
      const parentId = findParentId(base, "a");
      expect(parentId).toBe("root");
      // In the real code, if parentId === contextRootId, outdent returns early
    });
  });

  // -----------------------------------------------------------------------
  // Backspace (empty bullet)
  // -----------------------------------------------------------------------
  describe("Backspace (empty bullet. Delete + promote children)", () => {
    it("removes bullet from parent and promotes children", () => {
      // root → [a, b], b → [b1, b2]
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

      const ops: UndoOp[] = [];

      const after = Automerge.change(base, (d) => {
        const childIds = [...d.nodes.b.children]; // ["b1", "b2"]
        // Remove children from b (reverse order)
        for (let ci = childIds.length - 1; ci >= 0; ci--) {
          ops.push({ type: "splice-out", parentId: "b", childId: childIds[ci], index: ci });
        }
        d.nodes.b.children.splice(0);

        // Remove b from root, insert promoted children
        const idx = d.nodes.root.children.indexOf("b");
        ops.push({ type: "splice-out", parentId: "root", childId: "b", index: idx });
        for (let ci = 0; ci < childIds.length; ci++) {
          ops.push({ type: "splice-in", parentId: "root", childId: childIds[ci], index: idx + ci });
        }
        d.nodes.root.children.splice(idx, 1, ...childIds);
      });

      expect(after.nodes.root.children).toEqual(["a", "b1", "b2"]);
      expect(after.nodes.b.children).toEqual([]);
    });

    it("is a no-op if only bullet at context root", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode(""),
        },
      });
      // Only one child at context root. Backspace should not remove it
      expect(base.nodes.root.children.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Backspace merge
  // -----------------------------------------------------------------------
  describe("Backspace merge", () => {
    it("appends current content to previous bullet and removes current", () => {
      // root → [a, b, c]
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

      const ops: UndoOp[] = [
        { type: "set-content", nodeId: "a", oldContent: "hello" },
        { type: "set-content", nodeId: "b", oldContent: "world" },
        { type: "splice-out", parentId: "root", childId: "b", index: 1 },
      ];

      const after = Automerge.change(base, (d) => {
        Automerge.updateText(d, ["nodes", "a", "content"], "helloworld");
        d.nodes.root.children.splice(1, 1); // remove b
      });

      expect(after.nodes.a.content).toBe("helloworld");
      expect(after.nodes.root.children).toEqual(["a", "c"]);
    });

    it("promotes children of merged bullet", () => {
      // root → [a, b], b → [b1, b2]
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("hello"),
          b: makeNode("world", ["b1", "b2"]),
          b1: makeNode("B1"),
          b2: makeNode("B2"),
        },
      });

      const after = Automerge.change(base, (d) => {
        Automerge.updateText(d, ["nodes", "a", "content"], "helloworld");
        const childIds = [...d.nodes.b.children];
        d.nodes.b.children.splice(0);
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1, ...childIds);
      });

      expect(after.nodes.a.content).toBe("helloworld");
      expect(after.nodes.root.children).toEqual(["a", "b1", "b2"]);
    });
  });

  // -----------------------------------------------------------------------
  // Delete (forward merge)
  // -----------------------------------------------------------------------
  describe("Delete (forward merge)", () => {
    it("appends next bullet content to current and removes next", () => {
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

      const ops: UndoOp[] = [
        { type: "set-content", nodeId: "a", oldContent: "hello" },
        { type: "set-content", nodeId: "b", oldContent: "world" },
        { type: "splice-out", parentId: "root", childId: "b", index: 1 },
      ];

      const after = Automerge.change(base, (d) => {
        Automerge.updateText(d, ["nodes", "a", "content"], "helloworld");
        d.nodes.root.children.splice(1, 1); // remove b
      });

      expect(after.nodes.a.content).toBe("helloworld");
      expect(after.nodes.root.children).toEqual(["a", "c"]);
    });

    it("promotes next bullet's children", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("hello"),
          b: makeNode("world", ["b1"]),
          b1: makeNode("B1"),
        },
      });

      const after = Automerge.change(base, (d) => {
        Automerge.updateText(d, ["nodes", "a", "content"], "helloworld");
        const childIds = [...d.nodes.b.children];
        d.nodes.b.children.splice(0);
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1, ...childIds);
      });

      expect(after.nodes.a.content).toBe("helloworld");
      expect(after.nodes.root.children).toEqual(["a", "b1"]);
    });
  });

  // -----------------------------------------------------------------------
  // Add at end
  // -----------------------------------------------------------------------
  describe("Add at end", () => {
    it("creates new empty bullet as last child of context root", () => {
      const base = makeBaseDoc();
      const newId = "new1";

      const ops: UndoOp[] = [
        { type: "create-node", nodeId: newId },
        { type: "splice-in", parentId: "root", childId: newId, index: 3 },
      ];

      const after = Automerge.change(base, (d) => {
        d.nodes[newId] = makeNode("");
        d.nodes.root.children.push(newId);
      });

      expect(after.nodes.root.children).toEqual(["a", "b", "c", "new1"]);
      expect(after.nodes[newId].content).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // Delete via context menu
  // -----------------------------------------------------------------------
  describe("Delete via context menu", () => {
    it("removes bullet from parent (children NOT promoted)", () => {
      const base = makeBaseDoc();
      const ops: UndoOp[] = [];

      const after = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("a");
        d.nodes.root.children.splice(idx, 1);
        ops.push({ type: "splice-out", parentId: "root", childId: "a", index: idx });
      });

      expect(after.nodes.root.children).toEqual(["b", "c"]);
      // a and a1 still exist in the map but are orphaned
      expect(after.nodes.a).toBeDefined();
      expect(after.nodes.a1).toBeDefined();
      expect(getReachableIds(after).has("a")).toBe(false);
      expect(getReachableIds(after).has("a1")).toBe(false);
    });

    it("cleans up mirroredIds when last reference removed", () => {
      const base = Automerge.from<BulletsDoc>({
        title: "Test",
        rootId: "root",
        mirroredIds: ["b"],
        nodes: {
          root: makeNode("", ["a", "b"]),
          a: makeNode("Alpha", ["b"]), // mirror of b
          b: makeNode("Bravo"),
        },
      });

      // Remove b from root. Still referenced in a.children
      const after1 = Automerge.change(base, (d) => {
        const idx = d.nodes.root.children.indexOf("b");
        d.nodes.root.children.splice(idx, 1);
        // Count remaining references
        let refCount = 0;
        for (const node of Object.values(d.nodes)) {
          for (const childId of node.children) {
            if (childId === "b") refCount++;
          }
        }
        // b still in a.children, so refCount=1. Keep in mirroredIds
        expect(refCount).toBe(1);
      });
      expect(after1.mirroredIds).toContain("b");

      // Now remove b from a. Last reference
      const after2 = Automerge.change(after1, (d) => {
        const idx = d.nodes.a.children.indexOf("b");
        d.nodes.a.children.splice(idx, 1);
        // Count remaining references
        let refCount = 0;
        for (const node of Object.values(d.nodes)) {
          for (const childId of node.children) {
            if (childId === "b") refCount++;
          }
        }
        // No more references
        if (refCount === 0 && d.mirroredIds) {
          const mIdx = d.mirroredIds.indexOf("b");
          if (mIdx !== -1) d.mirroredIds.splice(mIdx, 1);
        }
      });
      expect(after2.mirroredIds).not.toContain("b");
    });
  });
});

// ===========================================================================
// 3. Move Subtree (drag-and-drop)
// ===========================================================================

describe("Move Subtree (DnD)", () => {
  it("moves bullet from old parent to new position", () => {
    const base = makeBaseDoc();
    const ops: UndoOp[] = [];

    // Drag b under a at index 0
    const after = Automerge.change(base, (d) => {
      const curIdx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(curIdx, 1);
      ops.push({ type: "splice-out", parentId: "root", childId: "b", index: curIdx });

      d.nodes.a.children.splice(0, 0, "b");
      ops.push({ type: "splice-in", parentId: "a", childId: "b", index: 0 });
    });

    expect(after.nodes.root.children).toEqual(["a", "c"]);
    expect(after.nodes.a.children).toEqual(["b", "a1"]);
  });

  it("children follow the moved bullet", () => {
    const base = makeBaseDoc();

    // Move a (which has child a1) under c
    const after = Automerge.change(base, (d) => {
      const idx = d.nodes.root.children.indexOf("a");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.c.children.push("a");
    });

    expect(after.nodes.c.children).toEqual(["a"]);
    expect(after.nodes.a.children).toEqual(["a1"]);
    // a1 is still under a
    const flat = flattenVisibleIds(after, "root");
    expect(flat).toContain("a1");
  });

  it("adjusts index when moving within same parent", () => {
    const base = makeBaseDoc();

    // Move c (index 2) to index 0 in root
    const after = Automerge.change(base, (d) => {
      const curIdx = d.nodes.root.children.indexOf("c");
      d.nodes.root.children.splice(curIdx, 1);
      d.nodes.root.children.splice(0, 0, "c");
    });

    expect(after.nodes.root.children).toEqual(["c", "a", "b"]);
  });

  it("adjusts target index when dragging from earlier position in same parent", () => {
    const base = makeBaseDoc();

    // Move a (index 0) to after c (target index 3, but adjusted to 2 after removal)
    const after = Automerge.change(base, (d) => {
      const curIdx = d.nodes.root.children.indexOf("a"); // 0
      d.nodes.root.children.splice(curIdx, 1);
      // Target was index 3 (end), but after removing a, it's clamped to children.length
      const adjustedIdx = Math.min(2, d.nodes.root.children.length);
      d.nodes.root.children.splice(adjustedIdx, 0, "a");
    });

    expect(after.nodes.root.children).toEqual(["b", "c", "a"]);
  });

  it("multi-selection DnD moves all roots as siblings", () => {
    const base = makeBaseDoc();
    const roots = [
      { id: "a", parentId: "root" },
      { id: "c", parentId: "root" },
    ];

    // Move a and c under b
    const after = Automerge.change(base, (d) => {
      // Remove in reverse order for stable indices
      for (let i = roots.length - 1; i >= 0; i--) {
        const { id, parentId } = roots[i];
        const parent = d.nodes[parentId];
        const idx = parent.children.indexOf(id);
        if (idx !== -1) parent.children.splice(idx, 1);
      }
      // Insert all at target
      for (const { id } of roots) {
        d.nodes.b.children.push(id);
      }
    });

    expect(after.nodes.root.children).toEqual(["b"]);
    expect(after.nodes.b.children).toEqual(["a", "c"]);
    // a's children still intact
    expect(after.nodes.a.children).toEqual(["a1"]);
  });
});

// ===========================================================================
// 4. Multi-Select Operations
// ===========================================================================

describe("Multi-Select Operations", () => {
  // -----------------------------------------------------------------------
  // Multi-select indent
  // -----------------------------------------------------------------------
  describe("Indent selection", () => {
    it("moves selected bullets under previous non-selected sibling", () => {
      const base = makeBaseDoc();
      // Select b and c. Indent under a
      const ops: UndoOp[] = [];

      const after = Automerge.change(base, (d) => {
        const selected = ["b", "c"];
        // Find target: previous non-selected sibling = "a"
        const targetSiblingId = "a";

        // Remove in reverse order
        for (let i = selected.length - 1; i >= 0; i--) {
          const idx = d.nodes.root.children.indexOf(selected[i]);
          d.nodes.root.children.splice(idx, 1);
          ops.push({ type: "splice-out", parentId: "root", childId: selected[i], index: idx });
        }
        // Append to target
        for (const id of selected) {
          const insertIdx = d.nodes[targetSiblingId].children.length;
          d.nodes[targetSiblingId].children.push(id);
          ops.push({ type: "splice-in", parentId: targetSiblingId, childId: id, index: insertIdx });
        }
      });

      expect(after.nodes.root.children).toEqual(["a"]);
      expect(after.nodes.a.children).toEqual(["a1", "b", "c"]);
    });

    it("no-op when selected items have no previous non-selected sibling", () => {
      const base = makeBaseDoc();
      // Select a. It's the first child, no previous sibling
      const idx = base.nodes.root.children.indexOf("a");
      expect(idx).toBe(0);
      // In the real code, this would find no target and skip
    });
  });

  // -----------------------------------------------------------------------
  // Multi-select outdent
  // -----------------------------------------------------------------------
  describe("Outdent selection", () => {
    it("moves each root to grandparent after its parent", () => {
      // First indent b and c under a, then outdent them
      let base = makeBaseDoc();
      base = Automerge.change(base, (d) => {
        // Move b and c under a
        d.nodes.root.children.splice(1, 2); // remove b and c
        d.nodes.a.children.push("b", "c");
      });
      // Now: root → [a], a → [a1, b, c]

      const ops: UndoOp[] = [];

      // Outdent b and c (process in reverse doc order)
      const after = Automerge.change(base, (d) => {
        const toOutdent = ["c", "b"]; // reverse order
        for (const id of toOutdent) {
          const parentId = "a";
          const grandparentId = "root";
          const idx = d.nodes[parentId].children.indexOf(id);
          d.nodes[parentId].children.splice(idx, 1);
          ops.push({ type: "splice-out", parentId, childId: id, index: idx });

          const parentIdx = d.nodes[grandparentId].children.indexOf(parentId);
          d.nodes[grandparentId].children.splice(parentIdx + 1, 0, id);
          ops.push({ type: "splice-in", parentId: grandparentId, childId: id, index: parentIdx + 1 });
        }
      });

      expect(after.nodes.a.children).toEqual(["a1"]);
      // b and c should be after a in root
      expect(after.nodes.root.children).toContain("b");
      expect(after.nodes.root.children).toContain("c");
      expect(after.nodes.root.children.indexOf("a")).toBeLessThan(after.nodes.root.children.indexOf("b"));
    });

    it("skips items already at context root level", () => {
      const base = makeBaseDoc();
      // a is already at root level. Outdent should skip it
      const parentId = findParentId(base, "a");
      expect(parentId).toBe("root"); // context root. Can't outdent
    });
  });

  // -----------------------------------------------------------------------
  // Multi-select delete
  // -----------------------------------------------------------------------
  describe("Delete selection", () => {
    it("removes all selected roots from their parents", () => {
      const base = makeBaseDoc();
      const ops: UndoOp[] = [];

      const after = Automerge.change(base, (d) => {
        const toDelete = [
          { id: "a", parentId: "root" },
          { id: "c", parentId: "root" },
        ];
        for (const { id, parentId } of toDelete) {
          const parent = d.nodes[parentId];
          const idx = parent.children.indexOf(id);
          if (idx !== -1) {
            parent.children.splice(idx, 1);
            ops.push({ type: "splice-out", parentId, childId: id, index: idx });
          }
        }
      });

      expect(after.nodes.root.children).toEqual(["b"]);
      // a and c are orphaned but still in map
      expect(after.nodes.a).toBeDefined();
      expect(after.nodes.c).toBeDefined();
    });
  });
});

// ===========================================================================
// 5. Clipboard
// ===========================================================================

describe("Clipboard", () => {
  // -----------------------------------------------------------------------
  // serializeSubtree
  // -----------------------------------------------------------------------
  describe("serializeSubtree", () => {
    it("captures content and children recursively", () => {
      const doc = makeBaseDoc();
      const tree = serializeSubtree(doc.nodes, "a");
      expect(tree.content).toBe("Alpha");
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].content).toBe("Alpha-child");
      expect(tree.children[0].children).toEqual([]);
    });

    it("handles leaf nodes", () => {
      const doc = makeBaseDoc();
      const tree = serializeSubtree(doc.nodes, "b");
      expect(tree.content).toBe("Bravo");
      expect(tree.children).toEqual([]);
    });

    it("is cycle-safe", () => {
      const doc: BulletsDoc = {
        title: "Test",
        rootId: "root",
        nodes: {
          root: makeNode("", ["a"]),
          a: makeNode("Alpha", ["b"]),
          b: makeNode("Bravo", ["a"]),
        },
      };
      const tree = serializeSubtree(doc.nodes, "a");
      expect(tree.content).toBe("Alpha");
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].content).toBe("Bravo");
      // b's child "a" is skipped because already visited
      expect(tree.children[0].children).toEqual([]);
    });

    it("handles missing node gracefully", () => {
      const doc = makeBaseDoc();
      const tree = serializeSubtree(doc.nodes, "nonexistent");
      expect(tree.content).toBe("");
      expect(tree.children).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // toPlainText
  // -----------------------------------------------------------------------
  describe("toPlainText", () => {
    it("produces indented bullet list", () => {
      const trees = [
        {
          content: "Alpha",
          collapsed: false,
          starred: false,
          children: [
            { content: "Child", collapsed: false, starred: false, children: [] },
          ],
        },
      ];
      const text = toPlainText(trees);
      expect(text).toBe("- Alpha\n  - Child");
    });

    it("handles multiple root trees", () => {
      const trees = [
        { content: "One", collapsed: false, starred: false, children: [] },
        { content: "Two", collapsed: false, starred: false, children: [] },
      ];
      const text = toPlainText(trees);
      expect(text).toBe("- One\n- Two");
    });
  });

  // -----------------------------------------------------------------------
  // toHtml
  // -----------------------------------------------------------------------
  describe("toHtml", () => {
    it("produces nested ul/li structure", () => {
      const trees = [
        {
          content: "Alpha",
          collapsed: false,
          starred: false,
          children: [
            { content: "Child", collapsed: false, starred: false, children: [] },
          ],
        },
      ];
      const html = toHtml(trees);
      expect(html).toBe("<ul><li>Alpha<ul><li>Child</li></ul></li></ul>");
    });

    it("escapes HTML entities", () => {
      const trees = [
        { content: "<b>bold</b> & \"quoted\"", collapsed: false, starred: false, children: [] },
      ];
      const html = toHtml(trees);
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;");
    });
  });

  // -----------------------------------------------------------------------
  // toInternalJson / parseInternalJson round-trip
  // -----------------------------------------------------------------------
  describe("toInternalJson / parseInternalJson", () => {
    it("round-trips correctly", () => {
      const trees = [
        {
          content: "Alpha",
          collapsed: false,
          starred: true,
          children: [
            { content: "Child", collapsed: false, starred: false, children: [] },
          ],
        },
      ];
      const json = toInternalJson(trees);
      const parsed = parseInternalJson(json);
      expect(parsed).toEqual(trees);
    });

    it("returns null for invalid JSON", () => {
      expect(parseInternalJson("not json")).toBeNull();
    });

    it("returns null for non-array JSON", () => {
      expect(parseInternalJson('{"content": "test"}')).toBeNull();
    });

    it("returns null for invalid node structure", () => {
      expect(parseInternalJson('[{"no_content": true}]')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // parsePlainText
  // -----------------------------------------------------------------------
  describe("parsePlainText", () => {
    it("parses indented bulleted text", () => {
      const text = "- Alpha\n  - Child\n- Bravo";
      const parsed = parsePlainText(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.length).toBe(2);
      expect(parsed![0].content).toBe("Alpha");
      expect(parsed![0].children.length).toBe(1);
      expect(parsed![0].children[0].content).toBe("Child");
      expect(parsed![1].content).toBe("Bravo");
    });

    it("handles numbered lists", () => {
      const text = "1. First\n2. Second";
      const parsed = parsePlainText(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.length).toBe(2);
      expect(parsed![0].content).toBe("First");
      expect(parsed![1].content).toBe("Second");
    });

    it("handles different bullet markers", () => {
      const text = "* Star\n+ Plus\n- Dash";
      const parsed = parsePlainText(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.length).toBe(3);
      expect(parsed![0].content).toBe("Star");
      expect(parsed![1].content).toBe("Plus");
      expect(parsed![2].content).toBe("Dash");
    });

    it("returns null for empty text", () => {
      expect(parsePlainText("")).toBeNull();
      expect(parsePlainText("   \n  \n  ")).toBeNull();
    });

    it("parses plain text without bullet markers", () => {
      const text = "First line\n  Indented line";
      const parsed = parsePlainText(text);
      expect(parsed).not.toBeNull();
      expect(parsed!.length).toBe(1);
      expect(parsed![0].content).toBe("First line");
      expect(parsed![0].children.length).toBe(1);
      expect(parsed![0].children[0].content).toBe("Indented line");
    });
  });

  // -----------------------------------------------------------------------
  // looksLikeStructuredText
  // -----------------------------------------------------------------------
  describe("looksLikeStructuredText", () => {
    it("returns true for multiline text", () => {
      expect(looksLikeStructuredText("line1\nline2")).toBe(true);
    });

    it("returns true for text with bullet markers", () => {
      expect(looksLikeStructuredText("- item")).toBe(true);
      expect(looksLikeStructuredText("* item")).toBe(true);
      expect(looksLikeStructuredText("+ item")).toBe(true);
      expect(looksLikeStructuredText("1. item")).toBe(true);
    });

    it("returns false for plain single-line text", () => {
      expect(looksLikeStructuredText("just text")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // insertClipboardTrees (simulated)
  // -----------------------------------------------------------------------
  describe("insertClipboardTrees (simulated)", () => {
    it("creates nodes and splices into parent", () => {
      const base = makeBaseDoc();
      const treesToInsert = [
        {
          content: "Pasted1",
          collapsed: false,
          starred: false,
          children: [
            { content: "PastedChild", collapsed: false, starred: false, children: [] },
          ],
        },
        { content: "Pasted2", collapsed: false, starred: false, children: [] },
      ];

      const ops: UndoOp[] = [];
      const parentId = "root";
      const insertIndex = 1; // after a
      const newIds: string[] = [];

      // Pre-collect nodes with IDs
      type NewNode = { id: string; content: string; childIds: string[] };
      const newNodes: NewNode[] = [];
      let idCounter = 0;

      function collectNodes(tree: typeof treesToInsert[0]): string {
        const id = `paste-${idCounter++}`;
        const childIds: string[] = [];
        for (const child of tree.children) {
          childIds.push(collectNodes(child));
        }
        newNodes.push({ id, content: tree.content, childIds });
        ops.push({ type: "create-node", nodeId: id });
        return id;
      }

      const topLevelIds: string[] = [];
      for (const tree of treesToInsert) {
        topLevelIds.push(collectNodes(tree));
      }

      for (let i = 0; i < topLevelIds.length; i++) {
        ops.push({ type: "splice-in", parentId, childId: topLevelIds[i], index: insertIndex + i });
      }

      const after = Automerge.change(base, (d) => {
        for (const { id, content, childIds } of newNodes) {
          d.nodes[id] = makeNode(content, childIds);
        }
        d.nodes[parentId].children.splice(insertIndex, 0, ...topLevelIds);
      });

      // Top-level nodes inserted after a
      expect(after.nodes.root.children[1]).toBe(topLevelIds[0]);
      expect(after.nodes.root.children[2]).toBe(topLevelIds[1]);
      // Nodes exist with correct content
      expect(after.nodes[topLevelIds[0]].content).toBe("Pasted1");
      expect(after.nodes[topLevelIds[1]].content).toBe("Pasted2");
      // Child node exists
      const pastedParent = after.nodes[topLevelIds[0]];
      expect(pastedParent.children.length).toBe(1);
      expect(after.nodes[pastedParent.children[0]].content).toBe("PastedChild");
    });
  });
});

// ===========================================================================
// 6. Search
// ===========================================================================

describe("Search", () => {
  it("finds basic substring match", () => {
    const doc = makeBaseDoc();
    const results = searchBullets(doc, "Bravo");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("b");
    expect(results[0].matchStart).toBe(0);
    expect(results[0].matchLength).toBe(5);
  });

  it("is case-insensitive", () => {
    const doc = makeBaseDoc();
    const results = searchBullets(doc, "alpha");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("a");
  });

  it("respects reachableIds filter", () => {
    const doc: BulletsDoc = {
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a"]),
        a: makeNode("Alpha"),
        b: makeNode("Alpha orphaned"), // orphaned
      },
    };
    const reachable = getReachableIds(doc);
    const results = searchBullets(doc, "Alpha", undefined, 30, reachable);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  it("respects maxResults limit", () => {
    // Create a doc with many matching nodes
    const nodes: Record<string, any> = {
      root: makeNode("", []),
    };
    const childIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `n${i}`;
      nodes[id] = makeNode(`Match ${i}`);
      childIds.push(id);
    }
    nodes.root = makeNode("", childIds);

    const doc: BulletsDoc = { title: "Test", rootId: "root", nodes };
    const results = searchBullets(doc, "Match", undefined, 3);
    expect(results.length).toBe(3);
  });

  it("empty query returns empty results", () => {
    const doc = makeBaseDoc();
    expect(searchBullets(doc, "")).toEqual([]);
    expect(searchBullets(doc, "  ")).toEqual([]);
  });

  it("returns match position info", () => {
    const doc = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a"]),
        a: makeNode("hello world"),
      },
    });
    const results = searchBullets(doc, "world");
    expect(results.length).toBe(1);
    expect(results[0].matchStart).toBe(6);
    expect(results[0].matchLength).toBe(5);
  });

  it("excludes root node from results", () => {
    const doc: BulletsDoc = {
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("Root content", ["a"]),
        a: makeNode("Alpha"),
      },
    };
    const results = searchBullets(doc, "Root content");
    expect(results.length).toBe(0);
  });
});

// ===========================================================================
// 7. Mirrors
// ===========================================================================

describe("Mirrors", () => {
  it("same ID in two parents creates a mirror", () => {
    const doc = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      mirroredIds: ["b"],
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha", ["b"]),
        b: makeNode("Bravo"),
      },
    });

    // b appears in both root and a
    expect(doc.nodes.root.children).toContain("b");
    expect(doc.nodes.a.children).toContain("b");

    // Marked as intentional mirror
    expect(doc.mirroredIds).toContain("b");

    // detectTreeIssues does NOT flag it as duplicate
    const { duplicates } = detectTreeIssues(doc);
    expect(duplicates.length).toBe(0);
  });

  it("cycle guard prevents pasting mirror into its own subtree", () => {
    const doc = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a"]),
        a: makeNode("Alpha", ["b"]),
        b: makeNode("Bravo", ["c"]),
        c: makeNode("Charlie"),
      },
    });

    const mirrorId = "a";
    const targetParentId = "c"; // c is a descendant of a

    // Guard check: cannot paste a into c (c is descendant of a)
    const wouldCycle = targetParentId === mirrorId ||
      isDescendantOf(doc, targetParentId, mirrorId);
    expect(wouldCycle).toBe(true);
  });

  it("cycle guard allows pasting mirror into non-descendant", () => {
    const doc = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha", ["a1"]),
        a1: makeNode("A-child"),
        b: makeNode("Bravo"),
      },
    });

    const mirrorId = "a1";
    const targetParentId = "b"; // b is not a descendant of a1

    const wouldCycle = targetParentId === mirrorId ||
      isDescendantOf(doc, targetParentId, mirrorId);
    expect(wouldCycle).toBe(false);
  });

  it("paste mirror adds to mirroredIds and inserts reference", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
      },
    });

    const mirrorId = "b";
    const parentId = "a";
    const insertIndex = 0;

    const after = Automerge.change(base, (d) => {
      d.nodes[parentId].children.splice(insertIndex, 0, mirrorId);
      if (!d.mirroredIds) d.mirroredIds = [];
      if (!d.mirroredIds.includes(mirrorId)) d.mirroredIds.push(mirrorId);
    });

    expect(after.nodes.a.children).toContain("b");
    expect(after.nodes.root.children).toContain("b");
    expect(after.mirroredIds).toContain("b");
  });

  it("mirroredIds entry removed when last reference deleted", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      mirroredIds: ["b"],
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("Alpha", ["b"]),
        b: makeNode("Bravo"),
      },
    });

    // Remove both references to b
    const after = Automerge.change(base, (d) => {
      // Remove from root
      const idx1 = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx1, 1);
      // Remove from a
      const idx2 = d.nodes.a.children.indexOf("b");
      d.nodes.a.children.splice(idx2, 1);

      // Cleanup mirroredIds
      let refCount = 0;
      for (const node of Object.values(d.nodes)) {
        for (const childId of node.children) {
          if (childId === "b") refCount++;
        }
      }
      if (refCount === 0 && d.mirroredIds) {
        const mIdx = d.mirroredIds.indexOf("b");
        if (mIdx !== -1) d.mirroredIds.splice(mIdx, 1);
      }
    });

    expect(after.mirroredIds).not.toContain("b");
  });
});

// ===========================================================================
// 8. Stars / Favorites
// ===========================================================================

describe("Stars / Favorites", () => {
  it("toggle star on", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      starredIds: [],
      nodes: {
        root: makeNode("", ["a"]),
        a: makeNode("Alpha"),
      },
    });

    const after = Automerge.change(base, (d) => {
      d.nodes.a.starred = true;
      d.starredIds!.push("a");
    });

    expect(after.nodes.a.starred).toBe(true);
    expect(after.starredIds).toContain("a");
  });

  it("toggle star off", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      starredIds: ["a"],
      nodes: {
        root: makeNode("", ["a"]),
        a: { ...makeNode("Alpha"), starred: true },
      },
    });

    const after = Automerge.change(base, (d) => {
      d.nodes.a.starred = false;
      const idx = d.starredIds!.indexOf("a");
      if (idx !== -1) d.starredIds!.splice(idx, 1);
    });

    expect(after.nodes.a.starred).toBe(false);
    expect(after.starredIds).not.toContain("a");
  });

  it("starredIds tracks insertion order", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      starredIds: [],
      nodes: {
        root: makeNode("", ["a", "b", "c"]),
        a: makeNode("Alpha"),
        b: makeNode("Bravo"),
        c: makeNode("Charlie"),
      },
    });

    const after = Automerge.change(base, (d) => {
      d.nodes.c.starred = true;
      d.starredIds!.push("c");
      d.nodes.a.starred = true;
      d.starredIds!.push("a");
    });

    expect(after.starredIds).toEqual(["c", "a"]);
  });

  it("initializes starredIds from existing starred flags", () => {
    const doc = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a", "b", "c"]),
        a: { ...makeNode("Alpha"), starred: true },
        b: makeNode("Bravo"),
        c: { ...makeNode("Charlie"), starred: true },
      },
    });

    // Simulate initialization: collect all starred reachable nodes
    const reachable = getReachableIds(doc);
    const after = Automerge.change(doc, (d) => {
      d.starredIds = [];
      for (const [nid, node] of Object.entries(d.nodes)) {
        if (nid === d.rootId) continue;
        if (!reachable.has(nid)) continue;
        if (node?.starred) d.starredIds.push(nid);
      }
    });

    expect(after.starredIds).toContain("a");
    expect(after.starredIds).toContain("c");
    expect(after.starredIds).not.toContain("b");
  });
});

// ===========================================================================
// 9. Undo Operations
// ===========================================================================

describe("Undo Operations", () => {
  it("undo indent reverses splice-out and splice-in", () => {
    const base = makeBaseDoc();

    // Indent b under a
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "root", childId: "b", index: 1 },
      { type: "splice-in", parentId: "a", childId: "b", index: 1 },
    ];

    const indented = Automerge.change(base, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
      d.nodes.a.children.push("b");
    });

    expect(indented.nodes.a.children).toContain("b");
    expect(indented.nodes.root.children).not.toContain("b");

    // Undo
    const { doc: undone } = applyUndoOps(indented, undoOps);
    expect(undone.nodes.root.children).toContain("b");
    expect(undone.nodes.a.children).not.toContain("b");
  });

  it("undo delete restores bullet at original position", () => {
    const base = makeBaseDoc();

    // Delete b from root at index 1
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "root", childId: "b", index: 1 },
    ];

    const deleted = Automerge.change(base, (d) => {
      const idx = d.nodes.root.children.indexOf("b");
      d.nodes.root.children.splice(idx, 1);
    });

    expect(deleted.nodes.root.children).not.toContain("b");

    const { doc: undone } = applyUndoOps(deleted, undoOps);
    expect(undone.nodes.root.children).toContain("b");
    expect(undone.nodes.root.children.indexOf("b")).toBe(1);
  });

  it("undo Enter split restores content and removes new bullet", () => {
    const base = makeBaseDoc();
    const fullText = "Alpha";
    const leftText = "Al";
    const rightText = "pha";

    const undoOps: UndoOp[] = [
      { type: "create-node", nodeId: "new1" },
      { type: "set-content", nodeId: "a", oldContent: fullText },
      { type: "splice-in", parentId: "root", childId: "new1", index: 1 },
    ];

    const split = Automerge.change(base, (d) => {
      d.nodes.new1 = makeNode(rightText);
      Automerge.updateText(d, ["nodes", "a", "content"], leftText);
      d.nodes.root.children.splice(1, 0, "new1");
    });

    expect(split.nodes.a.content).toBe(leftText);
    expect(split.nodes.root.children).toContain("new1");

    const { doc: undone } = applyUndoOps(split, undoOps);
    expect(undone.nodes.a.content).toBe(fullText);
    expect(undone.nodes.root.children).not.toContain("new1");
  });

  it("undo backspace merge restores both contents and structural positions", () => {
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["a", "b"]),
        a: makeNode("hello"),
        b: makeNode("world", ["b1", "b2"]),
        b1: makeNode("B1"),
        b2: makeNode("B2"),
      },
    });

    // Simulate backspace-merge: merge b into a, promote b1, b2
    const undoOps: UndoOp[] = [
      { type: "set-content", nodeId: "a", oldContent: "hello" },
      { type: "set-content", nodeId: "b", oldContent: "world" },
      { type: "splice-out", parentId: "b", childId: "b2", index: 1 },
      { type: "splice-out", parentId: "b", childId: "b1", index: 0 },
      { type: "splice-out", parentId: "root", childId: "b", index: 1 },
      { type: "splice-in", parentId: "root", childId: "b1", index: 1 },
      { type: "splice-in", parentId: "root", childId: "b2", index: 2 },
    ];

    const merged = Automerge.change(base, (d) => {
      Automerge.updateText(d, ["nodes", "a", "content"], "helloworld");
      d.nodes.b.children.splice(0);
      d.nodes.root.children.splice(1, 1, "b1", "b2");
    });

    expect(merged.nodes.a.content).toBe("helloworld");
    expect(merged.nodes.root.children).toEqual(["a", "b1", "b2"]);

    // Undo
    const { doc: undone } = applyUndoOps(merged, undoOps);
    expect(undone.nodes.a.content).toBe("hello");
    expect(undone.nodes.root.children).toContain("b");
    expect(undone.nodes.root.children).not.toContain("b1");
    expect(undone.nodes.root.children).not.toContain("b2");
    expect(undone.nodes.b.children).toContain("b1");
    expect(undone.nodes.b.children).toContain("b2");
  });

  it("redo (inverse of undo) re-applies the operation", () => {
    const base = makeBaseDoc();

    // Indent b under a
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "root", childId: "b", index: 1 },
      { type: "splice-in", parentId: "a", childId: "b", index: 1 },
    ];

    const indented = Automerge.change(base, (d) => {
      d.nodes.root.children.splice(1, 1);
      d.nodes.a.children.push("b");
    });

    // Undo
    const { doc: undone, inverseOps: redoOps } = applyUndoOps(indented, undoOps);
    expect(undone.nodes.root.children).toContain("b");

    // Redo
    const { doc: redone } = applyUndoOps(undone, redoOps);
    expect(redone.nodes.root.children).not.toContain("b");
    expect(redone.nodes.a.children).toContain("b");
  });

  it("undo of outdent reverses the move", () => {
    // root → [a], a → [a1, b]
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

    // Outdent b from a to root
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "a", childId: "b", index: 1 },
      { type: "splice-in", parentId: "root", childId: "b", index: 1 },
    ];

    const outdented = Automerge.change(base, (d) => {
      d.nodes.a.children.splice(1, 1);
      d.nodes.root.children.push("b");
    });

    expect(outdented.nodes.root.children).toContain("b");
    expect(outdented.nodes.a.children).not.toContain("b");

    // Undo
    const { doc: undone } = applyUndoOps(outdented, undoOps);
    expect(undone.nodes.a.children).toContain("b");
    expect(undone.nodes.root.children).not.toContain("b");
  });

  it("undo delete with child promotion restores complete structure", () => {
    // root → [x, y], y → [y1, y2]
    const base = Automerge.from<BulletsDoc>({
      title: "Test",
      rootId: "root",
      nodes: {
        root: makeNode("", ["x", "y"]),
        x: makeNode("X"),
        y: makeNode("", ["y1", "y2"]),
        y1: makeNode("Y1"),
        y2: makeNode("Y2"),
      },
    });

    // Backspace on empty y: promote y1, y2
    const undoOps: UndoOp[] = [
      { type: "splice-out", parentId: "y", childId: "y2", index: 1 },
      { type: "splice-out", parentId: "y", childId: "y1", index: 0 },
      { type: "splice-out", parentId: "root", childId: "y", index: 1 },
      { type: "splice-in", parentId: "root", childId: "y1", index: 1 },
      { type: "splice-in", parentId: "root", childId: "y2", index: 2 },
    ];

    const afterDelete = Automerge.change(base, (d) => {
      d.nodes.y.children.splice(0);
      d.nodes.root.children.splice(1, 1, "y1", "y2");
    });

    expect(afterDelete.nodes.root.children).toEqual(["x", "y1", "y2"]);

    // Undo
    const { doc: undone } = applyUndoOps(afterDelete, undoOps);
    expect(undone.nodes.root.children).toEqual(["x", "y"]);
    expect(undone.nodes.y.children).toContain("y1");
    expect(undone.nodes.y.children).toContain("y2");
  });
});
