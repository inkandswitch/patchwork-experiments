import type { DocHandle } from "@automerge/automerge-repo";
import type { Accessor } from "solid-js";
import type { BulletsDoc } from "../datatype.ts";
import { findParentId } from "../tree-utils.ts";
import { getActiveBulletId } from "../dom-utils.ts";
import type { ToolContext } from "../tool-context.ts";
import {
  serializeSubtree,
  toPlainText,
  toHtml,
  toInternalJson,
  MIME_TYPE as BULLETS_MIME,
  parseInternalJson,
  parseHtml,
  parsePlainText,
  looksLikeStructuredText,
  type ClipboardNode,
} from "../clipboard.ts";

export function useClipboard(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  selectedIds: Accessor<Set<string>>;
  getSelectionRoots: () => { id: string; parentId: string }[];
  deleteSelection: () => void;
  contextRootId: Accessor<string>;
  ctx: ToolContext;
  mirrorClipboardId: Accessor<string | null>;
  setMirrorClipboardId: (id: string | null) => void;
  setNodeCollapsed: (id: string, value: boolean) => void;
}) {
  const { doc, handle } = deps;

  /**
   * Copies a single bullet and its entire subtree to the clipboard.
   *
   * Triggered from the context menu rather than a native copy keystroke, so we
   * synthesize a copy event via execCommand to write all three formats with the
   * same fidelity as Cmd+C. If that fails (some browsers refuse execCommand
   * without a selection) we fall back to the async clipboard API with the plain
   * and HTML formats.
   */
  function copyBullet(id: string) {
    if (!doc.nodes[id]) return;
    const trees = [serializeSubtree(doc.nodes, id)];

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.clipboardData!.setData("text/plain", toPlainText(trees));
      e.clipboardData!.setData("text/html", toHtml(trees));
      e.clipboardData!.setData(BULLETS_MIME, toInternalJson(trees));
    };

    document.addEventListener("copy", onCopy, { capture: true, once: true });
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      document.removeEventListener("copy", onCopy, { capture: true });
    }

    if (!copied) {
      try {
        navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([toPlainText(trees)], { type: "text/plain" }),
            "text/html": new Blob([toHtml(trees)], { type: "text/html" }),
          }),
        ]);
      } catch {
        navigator.clipboard.writeText(toPlainText(trees));
      }
    }
  }

  function handleCopyEvent(e: ClipboardEvent) {
    deps.setMirrorClipboardId(null);

    if (deps.selectedIds().size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const roots = deps.getSelectionRoots();
      if (roots.length === 0) return;
      const trees = roots.map((r) => serializeSubtree(doc.nodes, r.id));
      e.clipboardData!.setData("text/plain", toPlainText(trees));
      e.clipboardData!.setData("text/html", toHtml(trees));
      e.clipboardData!.setData(BULLETS_MIME, toInternalJson(trees));
    }
  }

  function handleCutEvent(e: ClipboardEvent) {
    deps.setMirrorClipboardId(null);

    if (deps.selectedIds().size > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const roots = deps.getSelectionRoots();
      if (roots.length === 0) return;
      const trees = roots.map((r) => serializeSubtree(doc.nodes, r.id));
      e.clipboardData!.setData("text/plain", toPlainText(trees));
      e.clipboardData!.setData("text/html", toHtml(trees));
      e.clipboardData!.setData(BULLETS_MIME, toInternalJson(trees));
      deps.deleteSelection();
    }
  }

  function handlePasteEvent(e: ClipboardEvent) {
    if (deps.mirrorClipboardId()) return;

    const dt = e.clipboardData;
    if (!dt) return;

    let trees: ClipboardNode[] | null = null;

    const internal = dt.getData(BULLETS_MIME);
    if (internal) {
      trees = parseInternalJson(internal);
    }

    if (!trees) {
      const html = dt.getData("text/html");
      if (html) {
        trees = parseHtml(html);
      }
    }

    if (!trees) {
      const text = dt.getData("text/plain");
      if (text && looksLikeStructuredText(text)) {
        trees = parsePlainText(text);
      }
    }

    if (trees && trees.length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      insertClipboardTrees(trees);
    }
  }

  function insertClipboardTrees(trees: ClipboardNode[]) {
    const focusedId = getActiveBulletId();
    let parentId: string;
    let insertIndex: number;

    if (focusedId) {
      parentId = findParentId(doc, focusedId) ?? deps.contextRootId();
      const parent = doc.nodes[parentId];
      const idx = parent.children.indexOf(focusedId);
      insertIndex = idx !== -1 ? idx + 1 : parent.children.length;
    } else {
      parentId = deps.contextRootId();
      insertIndex = doc.nodes[parentId].children.length;
    }

    const ops: UndoOp[] = [];
    const newNodes: { id: string; data: ClipboardNode }[] = [];

    function collectNodes(tree: ClipboardNode): string {
      const id = crypto.randomUUID();
      newNodes.push({ id, data: tree });
      ops.push({ type: "create-node", nodeId: id });
      const childIds: string[] = [];
      for (const child of tree.children) {
        childIds.push(collectNodes(child));
      }
      (tree as ClipboardNode & { _childIds?: string[] })._childIds = childIds;
      return id;
    }

    const topLevelIds: string[] = [];
    for (const tree of trees) {
      topLevelIds.push(collectNodes(tree));
    }

    for (let i = 0; i < topLevelIds.length; i++) {
      ops.push({
        type: "splice-in",
        parentId,
        childId: topLevelIds[i],
        index: insertIndex + i,
      });
    }

    handle.change((d) => {
      for (const { id, data } of newNodes) {
        d.nodes[id] = {
          content: data.content,
          starred: data.starred,
          children: (data as ClipboardNode & { _childIds?: string[] })._childIds || [],
        };
        if (data.title !== undefined) {
          d.nodes[id].title = data.title;
        }
        if (data.contentType !== undefined) {
          d.nodes[id].contentType = data.contentType;
        }
        if (data.collapsed) {
          deps.setNodeCollapsed(id, true);
        }
      }
      const parent = d.nodes[parentId];
      parent.children.splice(insertIndex, 0, ...topLevelIds);
    });

    for (const tree of trees) {
      delete (tree as ClipboardNode & { _childIds?: string[] })._childIds;
    }

    deps.ctx.pushUndoOps(ops, focusedId);
    if (topLevelIds.length > 0) {
      deps.ctx.setFocusedBulletId(topLevelIds[0]);
    }
  }

  return {
    handleCopyEvent,
    handleCutEvent,
    handlePasteEvent,
    copyBullet,
  };
}
