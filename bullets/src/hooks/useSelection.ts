import { createSignal, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";
import { flattenVisibleWithParent, findParentId } from "../tree-utils.ts";
import { ikey, isNodeInSet } from "../instance-keys.ts";
import { getActiveBulletId } from "../dom-utils.ts";
import type { ToolContext } from "../tool-context.ts";

export function useSelection(deps: {
  handle: DocHandle<BulletsDoc>;
  doc: BulletsDoc;
  contextRootId: Accessor<string>;
  ctx: ToolContext;
  setNodeCollapsed: (id: string, value: boolean) => void;
  isNodeCollapsed: (id: string) => boolean;
  getBulletsListRef: () => HTMLDivElement | undefined;
}) {
  const { handle, doc } = deps;

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  let selectionAnchorId: string | null = null;

  // Mouse drag-select state
  let dragSelectAnchorId: string | null = null;
  let isDragSelecting = false;
  let _skipNextClickClear = false;

  function clearSelection() {
    setSelectedIds(new Set());
    selectionAnchorId = null;
  }

  function getInstanceKeyFromPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const row = (el as HTMLElement).closest?.(".bullet-row[data-bullet-id]") as HTMLElement | null;
    if (!row) return null;
    const nodeId = row.dataset.bulletId;
    const parentId = row.dataset.parentId;
    if (!nodeId || !parentId) return null;
    return ikey(nodeId, parentId);
  }

  function handleListMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.(".bullet-dot")) return;

    const key = getInstanceKeyFromPoint(e.clientX, e.clientY);
    if (key) {
      dragSelectAnchorId = key;
      isDragSelecting = false;
    }
  }

  function handleDocumentMouseMove(e: MouseEvent) {
    if (!dragSelectAnchorId) return;
    if (!(e.buttons & 1)) {
      dragSelectAnchorId = null;
      isDragSelecting = false;
      const bulletsListRef = deps.getBulletsListRef();
      if (bulletsListRef) bulletsListRef.classList.remove("drag-selecting");
      return;
    }

    const key = getInstanceKeyFromPoint(e.clientX, e.clientY);
    if (!key) return;

    if (!isDragSelecting) {
      if (key === dragSelectAnchorId) return;
      isDragSelecting = true;
      window.getSelection()?.removeAllRanges();
      const bulletsListRef = deps.getBulletsListRef();
      if (bulletsListRef) bulletsListRef.classList.add("drag-selecting");
    }

    const flat = flattenVisibleWithParent(doc, deps.contextRootId(), deps.isNodeCollapsed);
    const anchorIdx = flat.findIndex((e) => ikey(e.id, e.parentId) === dragSelectAnchorId);
    const currentIdx = flat.findIndex((e) => ikey(e.id, e.parentId) === key);
    if (anchorIdx === -1 || currentIdx === -1) return;

    const lo = Math.min(anchorIdx, currentIdx);
    const hi = Math.max(anchorIdx, currentIdx);
    const newSet = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      newSet.add(ikey(flat[i].id, flat[i].parentId));
    }
    setSelectedIds(newSet);
    selectionAnchorId = dragSelectAnchorId;
  }

  function handleDocumentMouseUp() {
    if (isDragSelecting) {
      _skipNextClickClear = true;
      setTimeout(() => { _skipNextClickClear = false; }, 0);
    }
    dragSelectAnchorId = null;
    isDragSelecting = false;
    const bulletsListRef = deps.getBulletsListRef();
    if (bulletsListRef) bulletsListRef.classList.remove("drag-selecting");
  }

  function extendSelection(fromId: string, fromParentId: string, direction: "up" | "down") {
    const flat = flattenVisibleWithParent(doc, deps.contextRootId(), deps.isNodeCollapsed);
    const fromKey = ikey(fromId, fromParentId);

    if (!selectionAnchorId || !flat.some(e => ikey(e.id, e.parentId) === selectionAnchorId)) {
      selectionAnchorId = fromKey;
    }

    const focusIdx = flat.findIndex(e => ikey(e.id, e.parentId) === fromKey);
    if (focusIdx === -1) return;

    const newFocusIdx = direction === "up" ? focusIdx - 1 : focusIdx + 1;
    if (newFocusIdx < 0 || newFocusIdx >= flat.length) return;

    const anchorIdx = flat.findIndex(e => ikey(e.id, e.parentId) === selectionAnchorId);

    const lo = Math.min(anchorIdx, newFocusIdx);
    const hi = Math.max(anchorIdx, newFocusIdx);
    const newSet = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      newSet.add(ikey(flat[i].id, flat[i].parentId));
    }
    setSelectedIds(newSet);
    deps.ctx.setFocusedBulletId(flat[newFocusIdx].id, flat[newFocusIdx].parentId);
  }

  function getSelectionRoots(): { id: string; parentId: string }[] {
    const sel = selectedIds();
    if (sel.size === 0) return [];
    const flat = flattenVisibleWithParent(doc, deps.contextRootId(), deps.isNodeCollapsed);
    const roots: { id: string; parentId: string }[] = [];
    for (const entry of flat) {
      const key = ikey(entry.id, entry.parentId);
      if (!sel.has(key)) continue;
      if (!isNodeInSet(sel, entry.parentId)) {
        roots.push({ id: entry.id, parentId: entry.parentId });
      }
    }
    return roots;
  }

  function indentSelection() {
    const roots = getSelectionRoots();
    if (roots.length === 0) return;

    const byParent = new Map<string, string[]>();
    for (const { id, parentId } of roots) {
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId)!.push(id);
    }

    const sel = selectedIds();
    const focusId = getActiveBulletId();
    const ops: UndoOp[] = [];
    const targetSiblingIds: string[] = [];

    handle.change((d) => {
      for (const [pid, ids] of byParent) {
        const parent = d.nodes[pid];
        const firstIdx = parent.children.indexOf(ids[0]);
        let targetSiblingId: string | null = null;
        for (let i = firstIdx - 1; i >= 0; i--) {
          const candidate = parent.children[i];
          if (!isNodeInSet(sel, candidate)) {
            targetSiblingId = candidate;
            break;
          }
        }
        if (!targetSiblingId) continue;
        targetSiblingIds.push(targetSiblingId);

        for (let i = ids.length - 1; i >= 0; i--) {
          const idx = parent.children.indexOf(ids[i]);
          if (idx !== -1) {
            parent.children.splice(idx, 1);
            d.nodes[ids[i]].originParentId = pid;
            d.nodes[ids[i]].originIndex = idx;
            ops.push({ type: "splice-out", parentId: pid, childId: ids[i], index: idx });
          }
        }
        const targetNode = d.nodes[targetSiblingId];
        for (const id of ids) {
          const insertIdx = targetNode.children.length;
          targetNode.children.push(id);
          ops.push({ type: "splice-in", parentId: targetSiblingId, childId: id, index: insertIdx });
        }
      }
    });

    for (const id of targetSiblingIds) {
      deps.setNodeCollapsed(id, false);
    }

    deps.ctx.pushUndoOps(ops, focusId);
    const focusTarget = roots[0].id;
    clearSelection();
    deps.ctx.setFocusedBulletId(focusTarget);
  }

  function outdentSelection() {
    const roots = getSelectionRoots();
    if (roots.length === 0) return;
    const ctxRoot = deps.contextRootId();

    const focusId = getActiveBulletId();
    const ops: UndoOp[] = [];

    const reversedRoots = [...roots].reverse();
    handle.change((d) => {
      for (const { id, parentId } of reversedRoots) {
        if (parentId === ctxRoot) continue;
        const grandparentId = findParentId(d, parentId);
        if (!grandparentId) continue;

        const parent = d.nodes[parentId];
        const idx = parent.children.indexOf(id);
        if (idx === -1) continue;
        parent.children.splice(idx, 1);
        d.nodes[id].originParentId = parentId;
        d.nodes[id].originIndex = idx;
        ops.push({ type: "splice-out", parentId, childId: id, index: idx });

        const grandparent = d.nodes[grandparentId];
        const parentIdx = grandparent.children.indexOf(parentId);
        const insertIdx = parentIdx + 1;
        grandparent.children.splice(insertIdx, 0, id);
        ops.push({ type: "splice-in", parentId: grandparentId, childId: id, index: insertIdx });
      }
    });

    deps.ctx.pushUndoOps(ops, focusId);
    const focusTarget = roots[0].id;
    clearSelection();
    deps.ctx.setFocusedBulletId(focusTarget);
  }

  function deleteSelection() {
    const roots = getSelectionRoots();
    if (roots.length === 0) return;
    const ctxRoot = deps.contextRootId();

    const flat = flattenVisibleWithParent(doc, ctxRoot, deps.isNodeCollapsed);
    const sel = selectedIds();
    const firstKey = ikey(roots[0].id, roots[0].parentId);
    const firstSelectedIdx = flat.findIndex(e => ikey(e.id, e.parentId) === firstKey);
    let focusTarget: string | null = null;
    if (firstSelectedIdx > 0) {
      for (let i = firstSelectedIdx - 1; i >= 0; i--) {
        if (!sel.has(ikey(flat[i].id, flat[i].parentId))) {
          focusTarget = flat[i].id;
          break;
        }
      }
    }

    const focusId = getActiveBulletId();
    const ops: UndoOp[] = [];

    handle.change((d) => {
      for (const { id, parentId } of roots) {
        const parent = d.nodes[parentId];
        if (!parent) continue;
        const idx = parent.children.indexOf(id);
        if (idx !== -1) {
          parent.children.splice(idx, 1);
          ops.push({ type: "splice-out", parentId, childId: id, index: idx });
        }
      }
    });

    deps.ctx.pushUndoOps(ops, focusId);
    clearSelection();
    if (focusTarget) deps.ctx.setFocusedBulletId(focusTarget);
  }

  deps.ctx.clearSelection = clearSelection;

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    handleListMouseDown,
    handleDocumentMouseMove,
    handleDocumentMouseUp,
    extendSelection,
    getSelectionRoots,
    indentSelection,
    outdentSelection,
    deleteSelection,
    isSkipNextClickClear: () => _skipNextClickClear,
    resetSkipNextClickClear: () => { _skipNextClickClear = false; },
  };
}
