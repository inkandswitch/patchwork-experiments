// Inserting and deleting rows and columns.

import { shiftRefs, type StructuralEdit } from '../lang/rewrite';
import { MAX_COLS } from '../lang/values';

type Data = (string | null)[][];

const isBlank = (cell: unknown) => cell === null || cell === undefined || cell === '';

function widthOf(data: Data): number {
  let width = 0;
  for (const row of data) width = Math.max(width, row?.length ?? 0);
  return Math.min(width, MAX_COLS);
}

/** Why an edit can't be made, or null if it can. */
export function checkEdit(data: Data, edit: StructuralEdit): string | null {
  if (edit.count < 1 || edit.index < 0) return 'Nothing to do.';

  if (edit.axis === 'row') {
    if (edit.kind === 'delete' && edit.count >= data.length) return "A sheet can't lose all of its rows.";
    return null;
  }

  const width = widthOf(data);
  if (edit.kind === 'delete') {
    return edit.count >= width ? "A sheet can't lose all of its columns." : null;
  }

  // Columns are named by a single letter, so there are at most 26 of them. Inserting one
  // pushes the last one off the sheet, which is only all right if it is empty.
  const overflow = width + edit.count - MAX_COLS;
  if (overflow <= 0) return null;
  if (edit.count > MAX_COLS - edit.index) return `A sheet has at most ${MAX_COLS} columns.`;
  for (const row of data) {
    for (let col = MAX_COLS - overflow; col < (row?.length ?? 0); col++) {
      if (!isBlank(row[col])) {
        return `There is no room: the sheet's last column${overflow === 1 ? ' is' : 's are'} not empty.`;
      }
    }
  }
  return null;
}

/**
 * Makes the edit, in place: fixes up the formulas that refer to cells that are about to
 * move, then moves the cells. `data` can be a plain array of arrays or the one inside an
 * Automerge change. (Check the edit with checkEdit first.)
 */
export function applyEdit(data: Data, edit: StructuralEdit): void {
  const width = widthOf(data);
  const { index, count } = edit;
  const doomed = (row: number, col: number) => {
    const i = edit.axis === 'row' ? row : col;
    return edit.kind === 'delete' && index <= i && i < index + count;
  };

  for (let row = 0; row < data.length; row++) {
    const cells = data[row];
    for (let col = 0; col < (cells?.length ?? 0); col++) {
      const text = cells[col];
      if (typeof text !== 'string' || text === '' || doomed(row, col)) continue;
      const shifted = shiftRefs(text, edit);
      if (shifted !== text) cells[col] = shifted;
    }
  }

  const blanks = (n: number) => new Array<string | null>(n).fill(null);

  if (edit.axis === 'row') {
    if (edit.kind === 'insert') {
      data.splice(Math.min(index, data.length), 0, ...Array.from({ length: count }, () => blanks(width)));
    } else {
      data.splice(index, count);
    }
    return;
  }

  for (const cells of data) {
    if (edit.kind === 'insert') {
      if (cells.length < index) cells.push(...blanks(index - cells.length));
      cells.splice(index, 0, ...blanks(count));
      if (cells.length > MAX_COLS) cells.splice(MAX_COLS, cells.length - MAX_COLS);
    } else if (index < cells.length) {
      // the sheet keeps its width: what is removed here is added back, blank, at the end
      const removed = Math.min(count, cells.length - index);
      cells.splice(index, removed);
      cells.push(...blanks(removed));
    }
  }
}
