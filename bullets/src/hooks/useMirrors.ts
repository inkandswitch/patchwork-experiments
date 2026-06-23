import { createSignal, createMemo, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";
import { findParentId, isDescendantOf } from "../tree-utils.ts";
import { getActiveBulletId } from "../dom-utils.ts";
import type { ToolContext } from "../tool-context.ts";

export function useMirrors(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  contextRootId: Accessor<string>;
  ctx: ToolContext;
}) {
  const { doc, handle } = deps;

  const [mirrorClipboardId, setMirrorClipboardId] = createSignal<string | null>(null);

  const refCounts = createMemo(() => {
    const counts = new Map<string, number>();
    if (!doc.nodes) return counts;
    for (const node of Object.values(doc.nodes)) {
      if (!node) continue;
      for (const childId of node.children) {
        counts.set(childId, (counts.get(childId) || 0) + 1);
      }
    }
    return counts;
  });

  const isNodeMirrored = (id: string) => (refCounts().get(id) ?? 0) > 1;

  function copyAsMirror(id: string) {
    setMirrorClipboardId(id);
  }

  function pasteMirror() {
    const mirrorId = mirrorClipboardId();
    if (!mirrorId) return;
    if (!doc.nodes[mirrorId]) return;

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

    if (parentId === mirrorId || isDescendantOf(doc, parentId, mirrorId)) return;

    deps.ctx.pushUndoOps([{ type: "splice-in", parentId, childId: mirrorId, index: insertIndex }]);
    handle.change((d) => {
      const parent = d.nodes[parentId];
      parent.children.splice(insertIndex, 0, mirrorId);
      if (!d.mirroredIds) d.mirroredIds = [];
      if (!d.mirroredIds.includes(mirrorId)) d.mirroredIds.push(mirrorId);
    });

    setMirrorClipboardId(null);
  }

  function handleMirrorKeys(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.shiftKey && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      e.stopPropagation();
      const id = getActiveBulletId();
      if (id) copyAsMirror(id);
      return;
    }

    if (e.key === "v" && !e.shiftKey && mirrorClipboardId()) {
      e.preventDefault();
      e.stopPropagation();
      pasteMirror();
      return;
    }
  }

  return {
    mirrorClipboardId,
    setMirrorClipboardId,
    refCounts,
    isNodeMirrored,
    copyAsMirror,
    pasteMirror,
    handleMirrorKeys,
  };
}
