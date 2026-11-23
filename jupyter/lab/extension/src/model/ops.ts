import type { Prop } from '@automerge/automerge';
import { automerge } from './automerge';
import { assign, emptyList, emptyMap, jsonEqual, readString, toPlain } from './json';
import { asList, cellToDoc, findCellIndex, sourcePath } from './notebook-doc';
import type { CellJSON, NotebookDoc } from './schema';
import type { Session } from './session';
import type { UndoOp } from './undo';

/**
 * Document mutations shared by the notebook, its cells and undo. Each one
 * records its inverse on the session when the transaction is undoable.
 */

export {
  asList,
  cellToDoc,
  findCellIndex,
  normalizeCellMetadata,
  notebookDoc,
  outputsToDoc,
  sourcePath
} from './notebook-doc';

export function applyUndoOp(session: Session, draft: NotebookDoc, op: UndoOp): void {
  switch (op.type) {
    case 'delete-text': {
      const index = findCellIndex(draft, op.cellId);
      if (index < 0 || !sameText(draft, index, op)) return;
      const path = sourcePath(index);
      const A = automerge();
      const start = A.getCursorPosition(draft, path, op.start);
      const last = A.getCursorPosition(draft, path, op.end);
      const lastStillThere = last < textLength(draft, index) && A.getCursor(draft, path, last) === op.end;
      const end = lastStillThere ? last + 1 : last;
      if (end > start) deleteText(session, draft, index, start, end - start);
      return;
    }
    case 'insert-text': {
      const index = findCellIndex(draft, op.cellId);
      if (index < 0 || !sameText(draft, index, op)) return;
      const at = op.at === null
        ? textLength(draft, index)
        : automerge().getCursorPosition(draft, sourcePath(index), op.at);
      insertText(session, draft, index, at, op.text);
      return;
    }
    case 'delete-cells':
      for (const id of op.ids) {
        const index = findCellIndex(draft, id);
        if (index >= 0) deleteCells(session, draft, index, 1);
      }
      return;
    case 'insert-cells': {
      const length = draft.cells?.length ?? 0;
      let index = Math.min(op.index, length);
      if (op.afterId === null) {
        index = 0;
      } else {
        const anchor = findCellIndex(draft, op.afterId);
        if (anchor >= 0) index = anchor + 1;
      }
      insertCells(session, draft, index, op.cells);
      return;
    }
    case 'set-metadata':
      setNotebookMetadata(session, draft, op.metadata);
      return;
  }
}

export function insertText(session: Session, draft: NotebookDoc, index: number, at: number, text: string): void {
  if (!text) return;
  const path = ensureSourceText(draft, index);
  const A = automerge();
  at = Math.max(0, Math.min(at, textLength(draft, index)));
  A.splice(draft, path, at, 0, text);
  if (session.recording) {
    session.record({
      type: 'delete-text',
      cellId: readString(draft.cells![index].id),
      objId: A.getObjectId(draft.cells![index], 'source')!,
      text,
      start: A.getCursor(draft, path, at),
      end: A.getCursor(draft, path, at + text.length - 1)
    });
  }
}

export function deleteText(session: Session, draft: NotebookDoc, index: number, at: number, length: number): void {
  const path = ensureSourceText(draft, index);
  const current = readString(draft.cells![index].source);
  at = Math.max(0, Math.min(at, current.length));
  length = Math.min(length, current.length - at);
  if (length <= 0) return;
  const A = automerge();
  A.splice(draft, path, at, length);
  if (session.recording) {
    session.record({
      type: 'insert-text',
      cellId: readString(draft.cells![index].id),
      objId: A.getObjectId(draft.cells![index], 'source')!,
      text: current.slice(at, at + length),
      at: at < current.length - length ? A.getCursor(draft, path, at) : null
    });
  }
}

export function insertCells(session: Session, draft: NotebookDoc, index: number, cells: CellJSON[]): void {
  if (cells.length === 0) return;
  if (!draft.cells) draft.cells = emptyList();
  index = Math.max(0, Math.min(index, draft.cells.length));
  asList(draft.cells).insertAt(index, ...cells.map(cellToDoc));
  session.record({ type: 'delete-cells', ids: cells.map(cell => cell.id!) });
}

export function deleteCells(session: Session, draft: NotebookDoc, index: number, count: number): void {
  const cells = draft.cells;
  if (!cells) return;
  count = Math.min(count, cells.length - index);
  if (count <= 0) return;
  if (session.recording) {
    session.record({
      type: 'insert-cells',
      afterId: index > 0 ? readString(cells[index - 1].id) : null,
      index,
      cells: cells.slice(index, index + count).map(cell => toPlain<CellJSON>(cell))
    });
  }
  asList(cells).deleteAt(index, count);
}

export function setNotebookMetadata(session: Session, draft: NotebookDoc, metadata: Record<string, unknown>): void {
  if (!draft.metadata) draft.metadata = emptyMap();
  const current = toPlain<Record<string, unknown>>(draft.metadata);
  session.record({ type: 'set-metadata', metadata: current });
  for (const key of Object.keys(current)) {
    if (!(key in metadata) || metadata[key] === undefined) delete draft.metadata[key];
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!jsonEqual(current[key], value)) {
      assign(draft.metadata, key, value);
    }
  }
}

export function updateNotebookMetadata(session: Session, draft: NotebookDoc, update: Record<string, unknown>): void {
  if (!draft.metadata) draft.metadata = emptyMap();
  session.record({ type: 'set-metadata', metadata: toPlain(draft.metadata) });
  for (const [key, value] of Object.entries(update)) {
    assign(draft.metadata, key, value);
  }
}

function textLength(draft: NotebookDoc, index: number): number {
  return readString(draft.cells![index].source).length;
}

/** Cursors are only valid on the text object they were made on; resolving others crashes wasm. */
function sameText(draft: NotebookDoc, index: number, op: { objId: string }): boolean {
  return automerge().getObjectId(draft.cells![index], 'source') === op.objId;
}

/** Peers may have stored the source as a scalar string; make it splice-able. */
function ensureSourceText(draft: NotebookDoc, index: number): Prop[] {
  const cell = draft.cells![index];
  if (typeof cell.source !== 'string') {
    cell.source = readString(cell.source);
  }
  return sourcePath(index);
}
