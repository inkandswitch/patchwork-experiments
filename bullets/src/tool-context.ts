import type { UndoOp } from "./datatype.ts";

export type ToolContext = {
  setFocusedBulletId: (id: string | null, parentHint?: string, cursorOffset?: number) => void;
  clearSelection: () => void;
  pushUndoOps: (ops: UndoOp[], focusId?: string | null) => void;
};

export function createToolContext(): ToolContext {
  return {
    setFocusedBulletId: () => {},
    clearSelection: () => {},
    pushUndoOps: () => {},
  };
}
