import type { EvalMode } from './model/run';
import type { SavedFilters } from './model/savedFilters';

/**
 * An Ambsheet document. `title` and `data` are exactly what the original Ambsheets
 * stored, so documents made with it open here too.
 */
export interface AmbsheetDoc {
  title: string;
  /**
   * The text of each cell, by row then column: a literal, an amb like "{500, 1200}", or a
   * formula like "=SUM(B3:B5)". Empty cells are null (or "", in older documents).
   *
   * NOTE: modeling a sheet as an array of arrays doesn't merge well when rows or columns
   * are inserted concurrently. See
   * https://mattweidner.com/2022/02/10/collaborative-data-design.html#case-study-a-collaborative-spreadsheet
   */
  data: (string | null)[][];
  /** How to evaluate the sheet. Absent means { mode: "auto" } with the default sample size. */
  evaluation?: { mode?: EvalMode; samples?: number };
  /** The filters in effect (see model/savedFilters.ts). Shared by everyone viewing the sheet. */
  filters?: SavedFilters;
}

/** A DocHandle, as far as this tool is concerned. */
export interface AmbsheetHandle {
  doc(): AmbsheetDoc | undefined;
  change(fn: (doc: AmbsheetDoc) => void): void;
  on(event: 'change', listener: () => void): void;
  off(event: 'change', listener: () => void): void;
}

export const DEFAULT_ROWS = 100;
export const DEFAULT_COLS = 26;

export const AmbsheetDatatype = {
  init(doc: AmbsheetDoc) {
    doc.title = 'Untitled Ambsheet';
    doc.data = Array.from({ length: DEFAULT_ROWS }, () => new Array(DEFAULT_COLS).fill(null));
  },

  getTitle(doc: AmbsheetDoc) {
    return doc.title || 'Untitled Ambsheet';
  },

  setTitle(doc: AmbsheetDoc, title: string) {
    doc.title = title;
  },

  markCopy(doc: AmbsheetDoc) {
    doc.title = 'Copy of ' + (doc.title || 'Untitled Ambsheet');
  },
};
