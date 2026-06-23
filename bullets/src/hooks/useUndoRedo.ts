import { updateText } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc, UndoOp } from "../datatype.ts";
import { getActiveBulletId } from "../dom-utils.ts";
import { MAX_UNDO_STACK_SIZE } from "../constants.ts";
import type { ToolContext } from "../tool-context.ts";

type UndoEntry = {
  ops: UndoOp[];
  focusId: string | null;
};

export function useUndoRedo(deps: {
  handle: DocHandle<BulletsDoc>;
  doc: BulletsDoc;
  ctx: ToolContext;
}) {
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  let textUndoNodeId: string | null = null;

  function pushUndoOps(ops: UndoOp[], focusId?: string | null) {
    const fid = focusId !== undefined ? focusId : getActiveBulletId();
    undoStack.push({ ops, focusId: fid });
    if (undoStack.length > MAX_UNDO_STACK_SIZE) undoStack.shift();
    redoStack.length = 0;
    textUndoNodeId = null;
  }

  function markTextEdit() {
    const bulletId = getActiveBulletId();
    if (!bulletId || bulletId === textUndoNodeId) return;
    const node = deps.doc.nodes[bulletId];
    if (!node) return;
    const ops: UndoOp[] = [{ type: "set-content", nodeId: bulletId, oldContent: node.content }];
    if (node.title !== undefined) {
      ops.push({ type: "set-title", nodeId: bulletId, oldTitle: node.title });
    }
    undoStack.push({ ops, focusId: bulletId });
    if (undoStack.length > MAX_UNDO_STACK_SIZE) undoStack.shift();
    redoStack.length = 0;
    textUndoNodeId = bulletId;
  }

  function applyUndoEntry(entry: UndoEntry): UndoEntry {
    const inverseOps: UndoOp[] = [];
    deps.handle.change((d) => {
      for (let i = entry.ops.length - 1; i >= 0; i--) {
        const op = entry.ops[i];
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
              updateText(d, ["nodes", op.nodeId, "content"], op.oldContent);
            }
            break;
          }
          case "set-title": {
            const n = d.nodes[op.nodeId];
            if (n) {
              inverseOps.push({ type: "set-title", nodeId: op.nodeId, oldTitle: n.title });
              if (typeof op.oldTitle === "string") {
                if (typeof n.title === "string") {
                  updateText(d, ["nodes", op.nodeId, "title"], op.oldTitle);
                } else {
                  n.title = op.oldTitle;
                }
              } else {
                n.title = op.oldTitle;
              }
            }
            break;
          }
          case "set-completed": {
            const n = d.nodes[op.nodeId];
            if (n) {
              inverseOps.push({ type: "set-completed", nodeId: op.nodeId, oldCompleted: !!n.completed });
              n.completed = op.oldCompleted;
            }
            break;
          }
          case "create-node":
            break;
        }
      }
    });
    return { ops: inverseOps, focusId: getActiveBulletId() };
  }

  function syncUndoContentToDom(ops: UndoOp[]) {
    for (const op of ops) {
      if (op.type === "set-content") {
        const el = document.querySelector(`.bullet-row[data-bullet-id="${op.nodeId}"] .bullet-content`) as HTMLElement | null;
        if (el) el.textContent = op.oldContent;
      }
    }
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return;
    const redoEntry = applyUndoEntry(entry);
    redoStack.push(redoEntry);
    syncUndoContentToDom(entry.ops);
    if (entry.focusId) deps.ctx.setFocusedBulletId(entry.focusId);
    textUndoNodeId = null;
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) return;
    const undoEntry = applyUndoEntry(entry);
    undoStack.push(undoEntry);
    syncUndoContentToDom(entry.ops);
    if (entry.focusId) deps.ctx.setFocusedBulletId(entry.focusId);
    textUndoNodeId = null;
  }

  function handleUndoRedo(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || (e.key !== "z" && e.key !== "Z")) return;
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
  }

  deps.ctx.pushUndoOps = pushUndoOps;

  return { pushUndoOps, markTextEdit, handleUndoRedo, undo, redo };
}
