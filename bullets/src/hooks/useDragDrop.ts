import { createSignal, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc, ImageDoc } from "../datatype.ts";
import { findParentId, flattenVisibleWithDepth, collectDescendantIds, imageLabelFromMimeType } from "../tree-utils.ts";
import { isNodeInSet } from "../instance-keys.ts";
import { getActiveBulletId } from "../dom-utils.ts";
import type { ToolContext } from "../tool-context.ts";
import {
  INDENT_WIDTH_PX,
  INDICATOR_LEFT_OFFSET_PX,
  DEPTH_ZERO_OFFSET_PX,
} from "../constants.ts";

export type DropTarget = {
  parentId: string;
  index: number;
  depth: number;
  indicatorY: number;
  indicatorLeft: number;
};

export function useDragDrop(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  contextRootId: Accessor<string>;
  ctx: ToolContext;
  selectedIds: Accessor<Set<string>>;
  getSelectionRoots: () => { id: string; parentId: string }[];
  setNodeCollapsed: (id: string, value: boolean) => void;
  isNodeCollapsed: (id: string) => boolean;
  setEmbedExpanded: (id: string, value: boolean) => void;
  getBulletsListRef: () => HTMLDivElement | undefined;
  getElement: () => HTMLElement;
}) {
  const { doc, handle } = deps;

  const [draggedId, setDraggedId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<DropTarget | null>(null);

  // File drag-and-drop state
  const [fileDragOver, setFileDragOver] = createSignal(false);
  let fileDragCounter = 0;

  function collectDescendants(id: string): Set<string> {
    return new Set(collectDescendantIds(doc, id));
  }

  function computeFileDropTarget(e: DragEvent): DropTarget | null {
    const bulletsListRef = deps.getBulletsListRef();
    if (!bulletsListRef) return null;

    const flat = flattenVisibleWithDepth(doc, deps.contextRootId(), deps.isNodeCollapsed);
    const allRows = Array.from(
      bulletsListRef.querySelectorAll<HTMLElement>(".bullet-row[data-bullet-id]")
    );
    const rowMap = new Map<string, HTMLElement>();
    for (const row of allRows) {
      rowMap.set(row.dataset.bulletId!, row);
    }
    const filteredRows = flat.map((entry) => rowMap.get(entry.id)!).filter(Boolean);
    const listRect = bulletsListRef.getBoundingClientRect();

    if (filteredRows.length === 0) {
      return { parentId: deps.contextRootId(), index: 0, depth: 0, indicatorY: 0, indicatorLeft: INDICATOR_LEFT_OFFSET_PX };
    }

    const mouseY = e.clientY;
    let gapIndex = flat.length;
    for (let i = 0; i < filteredRows.length; i++) {
      const rect = filteredRows[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (mouseY < midY) {
        gapIndex = i;
        break;
      }
    }

    let parentId: string;
    let insertIndex: number;
    let depth: number;

    if (gapIndex === 0) {
      parentId = deps.contextRootId();
      insertIndex = 0;
      depth = 0;
    } else {
      const above = flat[gapIndex - 1];
      const pid = findParentId(doc, above.id);
      if (!pid) {
        parentId = deps.contextRootId();
        insertIndex = 0;
        depth = 0;
      } else {
        parentId = pid;
        insertIndex = doc.nodes[parentId].children.indexOf(above.id) + 1;
        depth = above.depth;
      }
    }

    let indicatorY: number;
    if (gapIndex === 0) {
      indicatorY = filteredRows[0].getBoundingClientRect().top - listRect.top;
    } else if (gapIndex >= filteredRows.length) {
      const lastRect = filteredRows[filteredRows.length - 1].getBoundingClientRect();
      indicatorY = lastRect.bottom - listRect.top;
    } else {
      const aboveRect = filteredRows[gapIndex - 1].getBoundingClientRect();
      const belowRect = filteredRows[gapIndex].getBoundingClientRect();
      indicatorY = (aboveRect.bottom + belowRect.top) / 2 - listRect.top;
    }

    const indicatorLeft = depth * INDENT_WIDTH_PX + INDICATOR_LEFT_OFFSET_PX;

    return { parentId, index: insertIndex, depth, indicatorY, indicatorLeft };
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    const bulletsListRef = deps.getBulletsListRef();
    if (!bulletsListRef) return;

    if (hasFileType(e.dataTransfer)) {
      e.dataTransfer!.dropEffect = "copy";
      const target = computeFileDropTarget(e);
      setDropTarget(target);
      return;
    }

    e.dataTransfer!.dropEffect = "move";

    const dragged = draggedId();
    if (!dragged) return;

    const sel = deps.selectedIds();
    const isSelectionDrag = sel.size > 0 && isNodeInSet(sel, dragged);
    let excludeIds: Set<string>;
    if (isSelectionDrag) {
      excludeIds = new Set<string>();
      for (const { id: rootId } of deps.getSelectionRoots()) {
        for (const id of collectDescendants(rootId)) {
          excludeIds.add(id);
        }
      }
    } else {
      excludeIds = collectDescendants(dragged);
    }
    const flat = flattenVisibleWithDepth(doc, deps.contextRootId(), deps.isNodeCollapsed)
      .filter((entry) => !excludeIds.has(entry.id));

    const allRows = Array.from(
      bulletsListRef.querySelectorAll<HTMLElement>(".bullet-row[data-bullet-id]")
    );
    const rowMap = new Map<string, HTMLElement>();
    for (const row of allRows) {
      const id = row.dataset.bulletId!;
      if (!excludeIds.has(id)) {
        rowMap.set(id, row);
      }
    }
    const filteredRows = flat.map((entry) => rowMap.get(entry.id)!).filter(Boolean);

    const listRect = bulletsListRef.getBoundingClientRect();

    if (filteredRows.length === 0) {
      setDropTarget({
        parentId: deps.contextRootId(),
        index: 0,
        depth: 0,
        indicatorY: 0,
        indicatorLeft: INDICATOR_LEFT_OFFSET_PX,
      });
      return;
    }

    const mouseY = e.clientY;
    const mouseX = e.clientX;

    let gapIndex = flat.length;
    for (let i = 0; i < filteredRows.length; i++) {
      const rect = filteredRows[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (mouseY < midY) {
        gapIndex = i;
        break;
      }
    }

    const above = gapIndex > 0 ? flat[gapIndex - 1] : null;
    const below = gapIndex < flat.length ? flat[gapIndex] : null;

    let minDepth = below ? below.depth : 0;
    let maxDepth = above ? above.depth + 1 : 0;

    if (minDepth > maxDepth) {
      setDropTarget(null);
      return;
    }

    const baseX = listRect.left + DEPTH_ZERO_OFFSET_PX;
    const rawDepth = Math.round((mouseX - baseX) / INDENT_WIDTH_PX);
    const targetDepth = Math.max(minDepth, Math.min(maxDepth, rawDepth));

    let parentId: string;
    let insertIndex: number;

    if (!above) {
      parentId = deps.contextRootId();
      insertIndex = 0;
    } else if (targetDepth > above.depth) {
      parentId = above.id;
      insertIndex = 0;
    } else if (targetDepth === above.depth) {
      const pid = findParentId(doc, above.id);
      if (!pid) { setDropTarget(null); return; }
      parentId = pid;
      insertIndex = doc.nodes[parentId].children.indexOf(above.id) + 1;
    } else {
      let ancestorId = above.id;
      let ancestorDepth = above.depth;
      while (ancestorDepth > targetDepth) {
        const pid = findParentId(doc, ancestorId);
        if (!pid) { setDropTarget(null); return; }
        ancestorId = pid;
        ancestorDepth--;
      }
      const pid = findParentId(doc, ancestorId);
      if (!pid) { setDropTarget(null); return; }
      parentId = pid;
      insertIndex = doc.nodes[parentId].children.indexOf(ancestorId) + 1;
    }

    if (excludeIds.has(parentId)) {
      setDropTarget(null);
      return;
    }

    let indicatorY: number;
    if (gapIndex === 0) {
      indicatorY = filteredRows[0].getBoundingClientRect().top - listRect.top;
    } else if (gapIndex >= filteredRows.length) {
      const lastRect = filteredRows[filteredRows.length - 1].getBoundingClientRect();
      indicatorY = lastRect.bottom - listRect.top;
    } else {
      const aboveRect = filteredRows[gapIndex - 1].getBoundingClientRect();
      const belowRect = filteredRows[gapIndex].getBoundingClientRect();
      indicatorY = (aboveRect.bottom + belowRect.top) / 2 - listRect.top;
    }

    const indicatorLeft = targetDepth * INDENT_WIDTH_PX + INDICATOR_LEFT_OFFSET_PX;

    setDropTarget({ parentId, index: insertIndex, depth: targetDepth, indicatorY, indicatorLeft });
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();

    const dragged = draggedId();
    if (!dragged) return;

    const target = dropTarget();
    setDraggedId(null);
    setDropTarget(null);

    if (!target) return;

    const sel = deps.selectedIds();
    const isSelectionDrag = sel.size > 0 && isNodeInSet(sel, dragged);

    if (isSelectionDrag) {
      const roots = deps.getSelectionRoots();
      if (roots.length === 0) return;

      const focusId = getActiveBulletId();
      const ops: UndoOp[] = [];

      handle.change((d) => {
        let adjustment = 0;
        for (const { id: rootId, parentId: rootParentId } of roots) {
          if (rootParentId === target.parentId) {
            const idx = d.nodes[rootParentId].children.indexOf(rootId);
            if (idx !== -1 && idx < target.index) {
              adjustment++;
            }
          }
        }

        for (let i = roots.length - 1; i >= 0; i--) {
          const { id: rootId, parentId: rootParentId } = roots[i];
          const parent = d.nodes[rootParentId];
          if (!parent) continue;
          const idx = parent.children.indexOf(rootId);
          if (idx !== -1) {
            parent.children.splice(idx, 1);
            d.nodes[rootId].originParentId = rootParentId;
            d.nodes[rootId].originIndex = idx;
            ops.push({ type: "splice-out", parentId: rootParentId, childId: rootId, index: idx });
          }
        }

        const newParent = d.nodes[target.parentId];
        let insertIdx = Math.min(target.index - adjustment, newParent.children.length);
        for (const { id: rootId } of roots) {
          newParent.children.splice(insertIdx, 0, rootId);
          ops.push({ type: "splice-in", parentId: target.parentId, childId: rootId, index: insertIdx });
          insertIdx++;
        }
      });

      deps.setNodeCollapsed(target.parentId, false);

      deps.ctx.pushUndoOps(ops, focusId);
      deps.ctx.clearSelection();
      deps.ctx.setFocusedBulletId(roots[0].id);
    } else {
      const oldParentId = findParentId(doc, dragged);
      if (!oldParentId) return;
      if (doc.nodes[oldParentId].children.indexOf(dragged) === -1) return;

      const focusId = getActiveBulletId();
      const ops: UndoOp[] = [];

      handle.change((d) => {
        const oldParent = d.nodes[oldParentId];
        const curIdx = oldParent.children.indexOf(dragged);
        if (curIdx === -1) return;

        oldParent.children.splice(curIdx, 1);
        d.nodes[dragged].originParentId = oldParentId;
        d.nodes[dragged].originIndex = curIdx;
        ops.push({ type: "splice-out", parentId: oldParentId, childId: dragged, index: curIdx });

        let adjustedIndex = target.index;
        if (oldParentId === target.parentId && curIdx < target.index) {
          adjustedIndex--;
        }

        const newParent = d.nodes[target.parentId];
        adjustedIndex = Math.min(adjustedIndex, newParent.children.length);
        newParent.children.splice(adjustedIndex, 0, dragged);
        ops.push({ type: "splice-in", parentId: target.parentId, childId: dragged, index: adjustedIndex });
      });

      deps.setNodeCollapsed(target.parentId, false);

      deps.ctx.pushUndoOps(ops, focusId);
      deps.ctx.setFocusedBulletId(dragged);
    }
  }

  function handleFileDrop(files: FileList, target?: DropTarget | null) {
    let insertIdx = target ? target.index : doc.nodes[deps.contextRootId()]?.children.length ?? 0;
    const parentId = target ? target.parentId : deps.contextRootId();
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const idx = insertIdx;
      insertIdx++;
      const mimeType = file.type;

      file.arrayBuffer().then((buffer) => {
        const repo = (deps.getElement() as Record<string, unknown>).repo as
          | { create<T>(init?: T): { url: string } }
          | undefined;

        let amUrl: string;
        if (repo) {
          const imageHandle = repo.create<ImageDoc>({
            data: new Uint8Array(buffer),
            mimeType,
          } as ImageDoc);
          amUrl = imageHandle.url;
        } else {
          // Standalone fallback: store as data URL
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const newId = crypto.randomUUID();
            deps.ctx.pushUndoOps([
              { type: "create-node", nodeId: newId },
              { type: "splice-in", parentId, childId: newId, index: idx },
            ]);
            handle.change((d) => {
              d.nodes[newId] = {
                content: dataUrl,
                starred: false,
                children: [],
              };
              d.nodes[parentId].children.splice(idx, 0, newId);
            });
            deps.setEmbedExpanded(newId, true);
            deps.ctx.setFocusedBulletId(newId);
          };
          reader.readAsDataURL(file);
          return;
        }

        const newId = crypto.randomUUID();
        const title = imageLabelFromMimeType(mimeType);
        deps.ctx.pushUndoOps([
          { type: "create-node", nodeId: newId },
          { type: "splice-in", parentId, childId: newId, index: idx },
        ]);
        handle.change((d) => {
          d.nodes[newId] = {
            content: amUrl,
            contentType: "image",
            title,
            starred: false,
            children: [],
          };
          d.nodes[parentId].children.splice(idx, 0, newId);
        });
        deps.setEmbedExpanded(newId, true);
        deps.ctx.setFocusedBulletId(newId);
      });
    }
  }

  function hasFileType(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    for (const t of dt.types) {
      if (t === "Files") return true;
    }
    return false;
  }

  function handleDocFileDragEnter(e: DragEvent) {
    if (!hasFileType(e.dataTransfer)) return;
    fileDragCounter++;
    if (fileDragCounter === 1) setFileDragOver(true);
  }

  function handleDocFileDragLeave(e: DragEvent) {
    if (!hasFileType(e.dataTransfer)) return;
    fileDragCounter--;
    if (fileDragCounter === 0) setFileDragOver(false);
  }

  function handleDocFileDragOver(e: DragEvent) {
    if (hasFileType(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  }

  function handleDocFileDrop(e: DragEvent) {
    fileDragCounter = 0;
    setFileDragOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const target = dropTarget();
      setDropTarget(null);
      handleFileDrop(e.dataTransfer.files, target);
    }
  }

  function handleDragLeave(e: DragEvent) {
    const bulletsListRef = deps.getBulletsListRef();
    if (bulletsListRef && !bulletsListRef.contains(e.relatedTarget as Node)) {
      setDropTarget(null);
    }
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDropTarget(null);
  }

  return {
    draggedId,
    setDraggedId,
    dropTarget,
    setDropTarget,
    fileDragOver,
    handleDragOver,
    handleDrop,
    handleDragLeave,
    handleDragEnd,
    handleDocFileDragEnter,
    handleDocFileDragLeave,
    handleDocFileDragOver,
    handleDocFileDrop,
  };
}
