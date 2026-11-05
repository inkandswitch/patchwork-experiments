import type { Cursor } from '@automerge/automerge';
import type { CellJSON } from './schema';

/**
 * Inverse operations, anchored on cell ids and Automerge cursors so they stay
 * meaningful after concurrent edits from other peers.
 */
export type UndoOp =
  | { type: 'delete-text'; cellId: string; objId: string; text: string; start: Cursor; end: Cursor }
  | { type: 'insert-text'; cellId: string; objId: string; text: string; at: Cursor | null }
  | { type: 'delete-cells'; ids: string[] }
  | { type: 'insert-cells'; afterId: string | null; index: number; cells: CellJSON[] }
  | { type: 'set-metadata'; metadata: Record<string, unknown> };

export type StackItem = {
  ops: UndoOp[];
  meta: Map<any, any>;
};

/**
 * Mirrors the parts of Y.UndoManager JupyterLab relies on: capture timeout
 * merging, `stopCapturing`, and stack items carrying a `meta` map.
 */
export class UndoManager {
  constructor(apply: (manager: UndoManager, ops: UndoOp[]) => void) {
    this._apply = apply;
  }

  captureTimeout = 500;
  undoStack: StackItem[] = [];
  redoStack: StackItem[] = [];

  get undoing(): boolean {
    return this._mode === 'undoing';
  }

  get redoing(): boolean {
    return this._mode === 'redoing';
  }

  push(ops: UndoOp[]): void {
    if (this._mode === 'undoing') {
      this.redoStack.push({ ops, meta: new Map() });
      return;
    }
    if (this._mode === 'redoing') {
      this.undoStack.push({ ops, meta: new Map() });
      return;
    }
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && now - this._lastChange < this.captureTimeout) {
      last.ops.push(...ops);
    } else {
      this.undoStack.push({ ops, meta: new Map() });
    }
    this._lastChange = now;
    this.redoStack = [];
  }

  undo(): StackItem | null {
    return this._pop(this.undoStack, 'undoing');
  }

  redo(): StackItem | null {
    return this._pop(this.redoStack, 'redoing');
  }

  stopCapturing(): void {
    this._lastChange = 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  destroy(): void {
    this.clear();
  }

  private _pop(stack: StackItem[], mode: 'undoing' | 'redoing'): StackItem | null {
    const item = stack.pop();
    if (!item) return null;
    this._mode = mode;
    try {
      this._apply(this, item.ops.slice().reverse());
    } finally {
      this._mode = 'normal';
    }
    this._lastChange = 0;
    return item;
  }

  private _apply: (manager: UndoManager, ops: UndoOp[]) => void;
  private _lastChange = 0;
  private _mode: 'normal' | 'undoing' | 'redoing' = 'normal';
}
