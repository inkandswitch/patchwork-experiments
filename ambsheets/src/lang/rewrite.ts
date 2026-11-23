// Keeping formulas pointing at the right cells. Formulas are stored as text, so this
// rewrites the text, in two situations:
//
//   - When rows or columns are inserted or deleted (shiftRefs): B7 becomes B8 when a row
//     is inserted above it, SUM(B3:B5) grows or shrinks with the rows inside it, and a
//     reference to something that was deleted becomes #REF!.
//   - When a formula is copied to another cell (moveRefs): its references move along with
//     it, so =B6 * 2 copied one row down reads =B7 * 2. A "$" pins a column or a row:
//     $B$6 stays put, B$6 only follows sideways, $B6 only up and down.

import { parseCell, refSites, type CellSite } from './parse';
import { MAX_COLS, addrOf, posOf } from './values';

export interface StructuralEdit {
  kind: 'insert' | 'delete';
  axis: 'row' | 'col';
  /** Insert before this row or column, or delete starting at it. */
  index: number;
  count: number;
}

/** Where row or column `i` ends up after the edit. Null if it was deleted. */
export function shiftIndex(i: number, edit: StructuralEdit): number | null {
  if (edit.kind === 'insert') return i >= edit.index ? i + edit.count : i;
  if (i < edit.index) return i;
  return i >= edit.index + edit.count ? i - edit.count : null;
}

/** Where the cell at `addr` ends up after the edit. Null if it was deleted (or pushed off the sheet). */
export function shiftAddr(addr: string, edit: StructuralEdit): string | null {
  const pos = posOf(addr);
  const moved = shiftIndex(edit.axis === 'row' ? pos.row : pos.col, edit);
  if (moved === null) return null;
  const next = edit.axis === 'row' ? { row: moved, col: pos.col } : { row: pos.row, col: moved };
  return next.col < MAX_COLS ? addrOf(next) : null;
}

const REF_ERROR = '#REF!';

function print(site: CellSite, row: number, col: number): string {
  const letter = String.fromCharCode(65 + col);
  return site.colDollar + (site.lowerCase ? letter.toLowerCase() : letter) + site.rowDollar + (row + 1);
}

/** The text of a formula after the edit. (Anything that isn't a formula comes back unchanged.) */
export function shiftRefs(text: string, edit: StructuralEdit): string {
  const sites = refSites(text);
  if (sites.length === 0) return text;

  const along = (site: CellSite) => (edit.axis === 'row' ? site.row : site.col);
  const moved = (site: CellSite, to: number) =>
    edit.axis === 'row' ? print(site, to, site.col) : print(site, site.row, to);
  const limit = edit.axis === 'col' ? MAX_COLS : Infinity;

  const replacements: { start: number; end: number; text: string }[] = [];
  for (const site of sites) {
    if (site.kind === 'cell') {
      const to = shiftIndex(along(site.cell), edit);
      replacements.push({
        start: site.cell.start,
        end: site.cell.end,
        text: to === null || to >= limit ? REF_ERROR : moved(site.cell, to),
      });
      continue;
    }

    // A range survives as long as some of it does: deleting rows inside SUM(B3:B5) (or
    // at either end) shrinks it, and only deleting all of it leaves a #REF!.
    const [first, last] = along(site.a) <= along(site.b) ? [site.a, site.b] : [site.b, site.a];
    let lo = shiftIndex(along(first), edit);
    let hi = shiftIndex(along(last), edit);
    if (edit.kind === 'delete') {
      if (lo === null) lo = edit.index; // the first surviving row/column after the gap
      if (hi === null) hi = edit.index - 1; // the last one before it
    }
    if (lo === null || hi === null || lo > hi || lo >= limit) {
      replacements.push({ start: site.a.start, end: site.b.end, text: REF_ERROR });
    } else {
      replacements.push({ start: first.start, end: first.end, text: moved(first, lo) });
      replacements.push({ start: last.start, end: last.end, text: moved(last, Math.min(hi, limit - 1)) });
    }
  }

  return replace(text, replacements);
}

function replace(text: string, replacements: { start: number; end: number; text: string }[]): string {
  let result = text;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}

/**
 * The text of a cell as it should read in a copy that is `dRow` rows down and `dCol`
 * columns to the right of the original. (Anything that isn't a formula is copied as is.)
 *
 * A copy also loses the original's name, if it had one ("total = ..." becomes "=..."),
 * because a name can only stand for one cell.
 */
export function moveRefs(text: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return text;
  const parsed = parseCell(text);
  if (parsed.kind !== 'formula') return text;

  const moved = (site: CellSite): string | null => {
    const row = site.rowDollar ? site.row : site.row + dRow;
    const col = site.colDollar ? site.col : site.col + dCol;
    return row < 0 || col < 0 || col >= MAX_COLS ? null : print(site, row, col);
  };

  const replacements: { start: number; end: number; text: string }[] = [];
  for (const site of refSites(text)) {
    if (site.kind === 'cell') {
      replacements.push({ start: site.cell.start, end: site.cell.end, text: moved(site.cell) ?? REF_ERROR });
      continue;
    }
    const [a, b] = [moved(site.a), moved(site.b)];
    if (a === null || b === null) {
      replacements.push({ start: site.a.start, end: site.b.end, text: REF_ERROR });
    } else {
      replacements.push({ start: site.a.start, end: site.a.end, text: a });
      replacements.push({ start: site.b.start, end: site.b.end, text: b });
    }
  }
  if (parsed.name !== null) {
    // "total = SUM(B3:B5)" becomes "=SUM(...)"
    const eq = text.indexOf('=');
    const rest = text.slice(eq + 1);
    replacements.push({ start: 0, end: eq + 1 + (rest.length - rest.trimStart().length), text: '=' });
  }
  return replace(text, replacements);
}
