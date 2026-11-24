// Undo and redo.
//
// Every change to the cells goes through a History, which makes the change and remembers
// how to take it back. There are two kinds of change: setting the text of some cells
// (typing, pasting, filling, clearing), and inserting or deleting rows and columns.
//
// The history is local: it is this person's own changes in this session, not the
// document's. That matters when other people are editing the same sheet. Undoing a
// change to a cell only puts the old text back if the cell still says what the change
// made it say; if someone has changed it since, their text stays.

import type { StructuralEdit } from '../lang/rewrite';
import { MAX_COLS } from '../lang/values';
import { cellText } from './compile';
import {
  applyEdit,
  beforeEdit,
  checkEdit,
  unapplyEdit,
  writeCells,
  type CellText,
  type EditUndo,
} from './structure';

type Data = (string | null)[][];

export interface CellChange {
  row: number;
  col: number;
  before: string;
  after: string;
}

export type Change =
  | { kind: 'cells'; cells: CellChange[] }
  | { kind: 'structure'; edit: StructuralEdit; undo: EditUndo };

/** Where the cells live: something that can be read, and changed in one step. */
export interface Target {
  data(): Data;
  change(fn: (data: Data) => void): void;
}

export class History {
  private undone: Change[] = [];
  private done: Change[] = [];

  constructor(
    private readonly target: Target,
    private readonly limit = 200,
  ) {}

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  /** Sets the text of cells. Returns the change, or null if nothing was different. */
  setCells(updates: CellText[]): Change | null {
    const data = this.target.data();
    // (if a cell is mentioned twice, the last mention counts)
    const latest = new Map(updates.map((u) => [u.row + ',' + u.col, u]));
    const cells: CellChange[] = [];
    for (const { row, col, text } of latest.values()) {
      const before = cellText(data, row, col);
      if (row >= 0 && col >= 0 && col < MAX_COLS && before !== text) {
        cells.push({ row, col, before, after: text });
      }
    }
    if (cells.length === 0) return null;
    this.write(cells.map(({ row, col, after }) => ({ row, col, text: after })));
    return this.record({ kind: 'cells', cells });
  }

  /** Inserts or deletes rows or columns. Returns the change, or null if it can't be done. */
  structuralEdit(edit: StructuralEdit): Change | null {
    const data = this.target.data();
    if (checkEdit(data, edit) !== null) return null;
    const undo = beforeEdit(data, edit);
    this.target.change((d) => applyEdit(d, edit));
    return this.record({ kind: 'structure', edit, undo });
  }

  /** Takes back the latest change. Returns it (or null if there is nothing to undo). */
  undo(): Change | null {
    const change = this.done.pop();
    if (!change) return null;
    if (change.kind === 'cells') {
      this.write(
        change.cells
          .filter((c) => cellText(this.target.data(), c.row, c.col) === c.after)
          .map(({ row, col, before }) => ({ row, col, text: before })),
      );
    } else {
      this.target.change((d) => unapplyEdit(d, change.edit, change.undo));
    }
    this.undone.push(change);
    return change;
  }

  /** Makes the latest undone change again. Returns it (or null if there is nothing to redo). */
  redo(): Change | null {
    const change = this.undone.pop();
    if (!change) return null;
    if (change.kind === 'cells') {
      this.write(
        change.cells
          .filter((c) => cellText(this.target.data(), c.row, c.col) === c.before)
          .map(({ row, col, after }) => ({ row, col, text: after })),
      );
    } else {
      if (checkEdit(this.target.data(), change.edit) !== null) return null;
      // (what the edit destroys may not be quite what it destroyed the first time)
      change.undo = beforeEdit(this.target.data(), change.edit);
      this.target.change((d) => applyEdit(d, change.edit));
    }
    this.done.push(change);
    return change;
  }

  private write(cells: CellText[]) {
    if (cells.length > 0) this.target.change((d) => writeCells(d, cells));
  }

  private record(change: Change): Change {
    this.done.push(change);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = []; // a new change is a new future
    return change;
  }
}
