import { updateText } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc, UndoOp } from "./datatype.ts";
import {
  findAdjacentBulletContent,
  restoreCursor,
  focusBulletContent,
  isCursorOnFirstVisualLine,
  isCursorOnLastVisualLine,
} from "./dom-utils.ts";

export type BulletKeyboardDeps = {
  nodeId: string;
  parentId: string;
  contextRootId: () => string;
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  getContentRef: () => HTMLSpanElement;
  isImageUrl: () => boolean;
  hasChildren: () => boolean;
  isCollapsed: () => boolean;
  selectedIds: () => Set<string>;
  extendSelection: (fromId: string, fromParentId: string, direction: "up" | "down") => void;
  indentSelection: () => void;
  outdentSelection: () => void;
  deleteSelection: () => void;
  clearSelection: () => void;
  pushUndoOps: (ops: UndoOp[], focusId?: string | null) => void;
  setFocusedId: (id: string | null, parentHint?: string, cursorOffset?: number) => void;
  setNodeCollapsed: (id: string, value: boolean) => void;
  focusTitle: () => void;
};

export function createBulletKeyHandler(deps: BulletKeyboardDeps): (e: KeyboardEvent) => void {
  return function handleKeyDown(e: KeyboardEvent) {
    const id = deps.nodeId;
    const ctxRootId = deps.contextRootId();
    const hasSelection = deps.selectedIds().size > 0;
    const contentRef = deps.getContentRef();

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
    }

    // Shift+Arrow extends selection. But only escalate to bullet-level
    // selection when cursor is already on the first/last visual line (or
    // a multi-bullet selection is active).  Otherwise let the browser
    // extend the text selection within this bullet.
    if (e.key === "ArrowUp" && e.shiftKey && !e.metaKey) {
      if (hasSelection || isCursorOnFirstVisualLine(contentRef)) {
        e.preventDefault();
        deps.extendSelection(id, deps.parentId, "up");
        return;
      }
      return;
    }
    if (e.key === "ArrowDown" && e.shiftKey && !e.metaKey) {
      if (hasSelection || isCursorOnLastVisualLine(contentRef)) {
        e.preventDefault();
        deps.extendSelection(id, deps.parentId, "down");
        return;
      }
      return;
    }

    // Tab/Shift+Tab with active selection: bulk indent/outdent
    if (e.key === "Tab" && hasSelection) {
      if (e.shiftKey) {
        deps.outdentSelection();
      } else {
        deps.indentSelection();
      }
      return;
    }

    // Backspace/Delete with active selection: bulk delete
    if ((e.key === "Backspace" || e.key === "Delete") && hasSelection) {
      e.preventDefault();
      deps.deleteSelection();
      return;
    }

    // Enter: split text at cursor position
    if (e.key === "Enter") {
      deps.clearSelection();
      e.preventDefault();

      // For image bullets: create new empty sibling (don't split. Content is a data URL)
      if (deps.isImageUrl()) {
        const newId = crypto.randomUUID();
        if (deps.hasChildren() && !deps.isCollapsed()) {
          deps.pushUndoOps([
            { type: "create-node", nodeId: newId },
            { type: "splice-in", parentId: id, childId: newId, index: 0 },
          ]);
          deps.handle.change((doc) => {
            doc.nodes[newId] = { content: "", starred: false, children: [] };
            doc.nodes[id].children.splice(0, 0, newId);
          });
        } else {
          const idx = deps.doc.nodes[deps.parentId]?.children.indexOf(id) ?? -1;
          deps.pushUndoOps([
            { type: "create-node", nodeId: newId },
            { type: "splice-in", parentId: deps.parentId, childId: newId, index: idx + 1 },
          ]);
          deps.handle.change((doc) => {
            doc.nodes[newId] = { content: "", starred: false, children: [] };
            const parent = doc.nodes[deps.parentId];
            if (!parent) return;
            const i = parent.children.indexOf(id);
            parent.children.splice(i + 1, 0, newId);
          });
        }
        deps.setFocusedId(newId);
        return;
      }

      // Get cursor offset within the text
      const sel = window.getSelection();
      let cursorOffset = (contentRef.textContent || "").length;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(contentRef);
        preRange.setEnd(range.startContainer, range.startOffset);
        cursorOffset = preRange.toString().length;
      }

      const fullText = contentRef.textContent || "";
      const leftText = fullText.slice(0, cursorOffset);
      const rightText = fullText.slice(cursorOffset);
      const newId = crypto.randomUUID();

      if (deps.hasChildren() && !deps.isCollapsed()) {
        // Add as first child with the right portion
        deps.pushUndoOps([
          { type: "create-node", nodeId: newId },
          { type: "set-content", nodeId: id, oldContent: fullText },
          { type: "splice-in", parentId: id, childId: newId, index: 0 },
        ]);
        deps.handle.change((doc) => {
          doc.nodes[newId] = { content: rightText, starred: false, children: [] };
          updateText(doc, ["nodes", id, "content"], leftText);
          doc.nodes[id].children.splice(0, 0, newId);
        });
      } else {
        // Add as sibling after this bullet with the right portion
        const idx = deps.doc.nodes[deps.parentId]?.children.indexOf(id) ?? -1;
        deps.pushUndoOps([
          { type: "create-node", nodeId: newId },
          { type: "set-content", nodeId: id, oldContent: fullText },
          { type: "splice-in", parentId: deps.parentId, childId: newId, index: idx + 1 },
        ]);
        deps.handle.change((doc) => {
          doc.nodes[newId] = { content: rightText, starred: false, children: [] };
          updateText(doc, ["nodes", id, "content"], leftText);
          const parent = doc.nodes[deps.parentId];
          if (!parent) return;
          const i = parent.children.indexOf(id);
          parent.children.splice(i + 1, 0, newId);
        });
      }
      deps.setFocusedId(newId, undefined, 0);
      return;
    }

    if (e.key === "Tab" && !e.shiftKey) {
      // Indent: move this bullet's ID to be last child of previous sibling
      const parent = deps.doc.nodes[deps.parentId];
      if (!parent) return;
      const idx = parent.children.indexOf(id);
      if (idx <= 0) return; // Can't indent first child
      const prevSiblingId = parent.children[idx - 1];
      const prevSibling = deps.doc.nodes[prevSiblingId];
      const ops: UndoOp[] = [
        { type: "splice-out", parentId: deps.parentId, childId: id, index: idx },
        { type: "splice-in", parentId: prevSiblingId, childId: id, index: prevSibling?.children.length ?? 0 },
      ];
      deps.pushUndoOps(ops);
      deps.handle.change((doc) => {
        const parent = doc.nodes[deps.parentId];
        if (!parent) return;
        const idx = parent.children.indexOf(id);
        if (idx <= 0) return;
        parent.children.splice(idx, 1);
        doc.nodes[id].originParentId = deps.parentId;
        doc.nodes[id].originIndex = idx;
        doc.nodes[prevSiblingId].children.push(id);
      });
      deps.setNodeCollapsed(prevSiblingId, false);
      deps.setFocusedId(id, prevSiblingId);
    }

    if (e.key === "Tab" && e.shiftKey) {
      // Outdent: move this bullet's ID to be sibling of its parent
      if (deps.parentId === ctxRootId) return; // Don't outdent past context root
      const grandparentId = Object.keys(deps.doc.nodes).find(
        (nid) => deps.doc.nodes[nid].children.includes(deps.parentId)
      );
      if (!grandparentId) return; // Already at top level
      const parentNode = deps.doc.nodes[deps.parentId];
      const idx = parentNode.children.indexOf(id);
      const grandparent = deps.doc.nodes[grandparentId];
      const parentIdx = grandparent.children.indexOf(deps.parentId);
      deps.pushUndoOps([
        { type: "splice-out", parentId: deps.parentId, childId: id, index: idx },
        { type: "splice-in", parentId: grandparentId, childId: id, index: parentIdx + 1 },
      ]);
      deps.handle.change((doc) => {
        const parent = doc.nodes[deps.parentId];
        const i = parent.children.indexOf(id);
        parent.children.splice(i, 1);
        doc.nodes[id].originParentId = deps.parentId;
        doc.nodes[id].originIndex = i;
        const gp = doc.nodes[grandparentId];
        const pi = gp.children.indexOf(deps.parentId);
        gp.children.splice(pi + 1, 0, id);
      });
      deps.setFocusedId(id, grandparentId);
    }

    if (e.key === "Backspace") {
      // Detect cursor at position 0
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(contentRef);
      preRange.setEnd(range.startContainer, range.startOffset);
      const cursorOffset = preRange.toString().length;
      if (cursorOffset !== 0 || !sel.isCollapsed) return; // Not at start, or text selected. Let browser handle

      e.preventDefault();
      const content = (contentRef.textContent || "");
      const prevEl = findAdjacentBulletContent(contentRef, "up");

      // Don't delete if it's the only bullet at context root level and empty
      const ctxRoot = deps.doc.nodes[ctxRootId];
      if (ctxRoot.children.length === 1 && ctxRoot.children[0] === id && !deps.hasChildren()) {
        return;
      }

      const ops: UndoOp[] = [];

      if (content.length > 0 && prevEl) {
        // Merge: append current content to end of previous bullet
        const prevRow = prevEl.closest(".bullet-row") as HTMLElement | null;
        const prevBulletId = prevRow?.dataset.bulletId;
        const prevContent = prevEl.textContent || "";

        if (prevBulletId) {
          ops.push({ type: "set-content", nodeId: prevBulletId, oldContent: prevContent });
          ops.push({ type: "set-content", nodeId: id, oldContent: content });
        }

        deps.handle.change((doc) => {
          const parent = doc.nodes[deps.parentId];
          if (!parent) return;
          const n = doc.nodes[id];
          if (!n) return;

          // Merge content into previous bullet
          if (prevBulletId) {
            const prevNode = doc.nodes[prevBulletId];
            if (prevNode) updateText(doc, ["nodes", prevBulletId, "content"], prevContent + content);
          }

          // Promote children of current bullet
          const idx = parent.children.indexOf(id);
          const childIds = [...n.children];
          for (let ci = childIds.length - 1; ci >= 0; ci--) {
            ops.push({ type: "splice-out", parentId: id, childId: childIds[ci], index: ci });
          }
          n.children.splice(0);
          ops.push({ type: "splice-out", parentId: deps.parentId, childId: id, index: idx });
          for (let ci = 0; ci < childIds.length; ci++) {
            ops.push({ type: "splice-in", parentId: deps.parentId, childId: childIds[ci], index: idx + ci });
          }
          parent.children.splice(idx, 1, ...childIds);
        });
        deps.pushUndoOps(ops);
        // Update prev DOM and restore cursor at merge point
        prevEl.textContent = prevContent + content;
        restoreCursor(prevEl, prevContent.length);
      } else {
        // Empty bullet or no prev: delete and focus prev (original behavior)
        deps.handle.change((doc) => {
          const parent = doc.nodes[deps.parentId];
          if (!parent) return;
          const n = doc.nodes[id];
          if (!n) return;
          const idx = parent.children.indexOf(id);
          const childIds = [...n.children];
          for (let ci = childIds.length - 1; ci >= 0; ci--) {
            ops.push({ type: "splice-out", parentId: id, childId: childIds[ci], index: ci });
          }
          n.children.splice(0);
          ops.push({ type: "splice-out", parentId: deps.parentId, childId: id, index: idx });
          for (let ci = 0; ci < childIds.length; ci++) {
            ops.push({ type: "splice-in", parentId: deps.parentId, childId: childIds[ci], index: idx + ci });
          }
          parent.children.splice(idx, 1, ...childIds);
        });
        deps.pushUndoOps(ops);
        if (prevEl) {
          focusBulletContent(prevEl);
        }
      }
    }

    if (e.key === "Delete") {
      // Detect cursor at end of content
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(contentRef);
      preRange.setEnd(range.startContainer, range.startOffset);
      const cursorOffset = preRange.toString().length;
      const textLen = (contentRef.textContent || "").length;
      if (cursorOffset !== textLen || !sel.isCollapsed) return; // Not at end, or text selected. Let browser handle

      e.preventDefault();
      const content = contentRef.textContent || "";
      const nextEl = findAdjacentBulletContent(contentRef, "down");
      if (!nextEl) return; // Last bullet, nothing to merge

      const nextRow = nextEl.closest(".bullet-row") as HTMLElement | null;
      const nextBulletId = nextRow?.dataset.bulletId;
      const nextParentId = nextRow?.dataset.parentId;
      if (!nextBulletId || !nextParentId) return;

      const nextContent = nextEl.textContent || "";
      const ops: UndoOp[] = [];

      ops.push({ type: "set-content", nodeId: id, oldContent: content });
      ops.push({ type: "set-content", nodeId: nextBulletId, oldContent: nextContent });

      deps.handle.change((doc) => {
        // Append next bullet's text to current
        const curNode = doc.nodes[id];
        if (curNode) updateText(doc, ["nodes", id, "content"], content + nextContent);

        // Promote next bullet's children into next's parent
        const nextNode = doc.nodes[nextBulletId];
        const nextParent = doc.nodes[nextParentId];
        if (!nextNode || !nextParent) return;

        const idx = nextParent.children.indexOf(nextBulletId);
        const childIds = [...nextNode.children];
        for (let ci = childIds.length - 1; ci >= 0; ci--) {
          ops.push({ type: "splice-out", parentId: nextBulletId, childId: childIds[ci], index: ci });
        }
        nextNode.children.splice(0);
        ops.push({ type: "splice-out", parentId: nextParentId, childId: nextBulletId, index: idx });
        for (let ci = 0; ci < childIds.length; ci++) {
          ops.push({ type: "splice-in", parentId: nextParentId, childId: childIds[ci], index: idx + ci });
        }
        nextParent.children.splice(idx, 1, ...childIds);
      });

      deps.pushUndoOps(ops);
      // Update DOM and keep cursor at merge seam
      contentRef.textContent = content + nextContent;
      restoreCursor(contentRef, content.length);
    }

    if (e.key === "ArrowUp" && !e.metaKey) {
      if (isCursorOnFirstVisualLine(contentRef)) {
        e.preventDefault();
        deps.clearSelection();
        const prevEl = findAdjacentBulletContent(contentRef, "up");
        if (prevEl) {
          focusBulletContent(prevEl);
        } else {
          deps.focusTitle();
        }
      }
      // else: let browser navigate within visual lines
    }

    if (e.key === "ArrowDown" && !e.metaKey) {
      if (isCursorOnLastVisualLine(contentRef)) {
        e.preventDefault();
        deps.clearSelection();
        const nextEl = findAdjacentBulletContent(contentRef, "down");
        if (nextEl) {
          focusBulletContent(nextEl);
        }
      }
      // else: let browser navigate within visual lines
    }

    if (e.key === "ArrowLeft" && !e.shiftKey && !e.metaKey) {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(contentRef);
        preRange.setEnd(range.startContainer, range.startOffset);
        if (preRange.toString().length === 0) {
          e.preventDefault();
          const prevEl = findAdjacentBulletContent(contentRef, "up");
          if (prevEl) {
            focusBulletContent(prevEl);
          } else {
            deps.focusTitle();
          }
        }
      }
    }

    if (e.key === "ArrowRight" && !e.shiftKey && !e.metaKey) {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(contentRef);
        preRange.setEnd(range.startContainer, range.startOffset);
        const textLen = (contentRef.textContent || "").length;
        if (preRange.toString().length === textLen) {
          e.preventDefault();
          const nextEl = findAdjacentBulletContent(contentRef, "down");
          if (nextEl) {
            nextEl.focus();
            restoreCursor(nextEl, 0);
            nextEl.scrollIntoView({ block: "nearest" });
          }
        }
      }
    }
  };
}
