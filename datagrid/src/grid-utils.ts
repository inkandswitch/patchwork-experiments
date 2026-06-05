import type { DataGridDoc } from "./datatype";

export const DEFAULT_ROWS = 100;
export const DEFAULT_COLS = 26;
export const EMPTY_CELL = "";

export type CellValue = string | number | boolean;

export function createEmptyGrid(
  rows = DEFAULT_ROWS,
  cols = DEFAULT_COLS
): CellValue[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => EMPTY_CELL)
  );
}

export function columnCount(data: CellValue[][]): number {
  if (data.length === 0) return DEFAULT_COLS;
  return Math.max(
    1,
    ...data.map((row) => (Array.isArray(row) ? row.length : 0))
  );
}

/** Repair missing or malformed grid structure in-place. */
export function ensureGridStructure(doc: DataGridDoc): void {
  if (!Array.isArray(doc.data) || doc.data.length === 0) {
    doc.data = createEmptyGrid();
    return;
  }

  const cols = columnCount(doc.data);
  for (let row = 0; row < doc.data.length; row++) {
    if (!Array.isArray(doc.data[row])) {
      doc.data[row] = Array.from({ length: cols }, () => EMPTY_CELL);
    }
  }
}

/** Grow the grid so `data[row][column]` can be written. */
export function ensureCellWritable(
  doc: DataGridDoc,
  row: number,
  column: number
): void {
  ensureGridStructure(doc);

  const neededCols = column + 1;
  let cols = columnCount(doc.data);
  if (neededCols > cols) {
    for (const rowData of doc.data) {
      while (rowData.length < neededCols) {
        rowData.push(EMPTY_CELL);
      }
    }
    cols = neededCols;
  }

  while (doc.data.length <= row) {
    doc.data.push(Array.from({ length: cols }, () => EMPTY_CELL));
  }

  const targetRow = doc.data[row];
  while (targetRow.length <= column) {
    targetRow.push(EMPTY_CELL);
  }
}

export function createEmptyRows(
  amount: number,
  colCount: number
): CellValue[][] {
  return Array.from({ length: amount }, () =>
    Array.from({ length: colCount }, () => EMPTY_CELL)
  );
}

export function createEmptyCells(amount: number): CellValue[] {
  return Array.from({ length: amount }, () => EMPTY_CELL);
}
