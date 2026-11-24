import type { Prop } from '@automerge/automerge';
import type * as nbformat from '@jupyterlab/nbformat';
import { JSONExt } from '@lumino/coreutils';
import { automerge, realm } from './automerge';
import { assign, emptyList, emptyMap, jsonEqual, readString, toAutomerge, toPlain } from './json';
import type { CellJSON, NotebookDoc } from './schema';
import type { Session } from './session';
import type { UndoOp } from './undo';

/**
 * Document mutations shared by the notebook, its cells and undo. Each one
 * records its inverse on the session when the transaction is undoable.
 */

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

/**
 * The document for an nbformat notebook. Cells get fresh ids unless the
 * notebook has them (nbformat 4.5 and later).
 */
export function notebookDoc(notebook: nbformat.INotebookContent, title: string): NotebookDoc {
  const useIds = notebook.nbformat === 4 && notebook.nbformat_minor >= 5;
  return {
    title,
    nbformat: notebook.nbformat,
    nbformat_minor: notebook.nbformat_minor,
    metadata: toAutomerge(notebook.metadata ?? {}) as NotebookDoc['metadata'],
    cells: realm().Array.from(notebook.cells ?? [], cell =>
      cellToDoc({ ...cell, id: (useIds && (cell.id as string)) || crypto.randomUUID() } as CellJSON)
    ) as NotebookDoc['cells']
  };
}

/** Convert a cell from nbformat JSON to its document representation. */
export function cellToDoc(cell: CellJSON): Record<string, unknown> {
  const { id, cell_type, source, metadata, outputs, execution_count, attachments, ...rest } =
    cell as CellJSON & Record<string, any>;
  const doc = toAutomerge(rest) as Record<string, unknown>;
  doc.id = toAutomerge(id);
  doc.cell_type = toAutomerge(cell_type);
  doc.source = Array.isArray(source) ? source.join('') : (source ?? '');
  doc.metadata = toAutomerge(normalizeCellMetadata(metadata ?? {}));
  if (cell_type === 'code') {
    doc.execution_count = execution_count ?? null;
    doc.outputs = outputsToDoc(outputs ?? []);
  } else if (attachments != null) {
    doc.attachments = toAutomerge(attachments);
  }
  return doc;
}

export function outputsToDoc(outputs: nbformat.IOutput[]): unknown[] {
  return realm().Array.from(outputs, output => {
    if (output.output_type !== 'stream') {
      return toAutomerge(output);
    }
    const { text, ...rest } = output as nbformat.IStream;
    const doc = toAutomerge(rest) as Record<string, unknown>;
    doc.text = Array.isArray(text) ? text.join('') : (text ?? '');
    return doc;
  });
}

/** Keep `collapsed` and `jupyter.outputs_hidden` in sync, as @jupyter/ydoc does. */
export function normalizeCellMetadata(metadata: Record<string, any>): Record<string, any> {
  const clone = JSONExt.deepCopy(metadata) as Record<string, any>;
  if (clone.collapsed != null) {
    clone.jupyter = clone.jupyter || {};
    clone.jupyter.outputs_hidden = clone.collapsed;
  } else if (clone?.jupyter?.outputs_hidden != null) {
    clone.collapsed = clone.jupyter.outputs_hidden;
  }
  return clone;
}

export function findCellIndex(doc: NotebookDoc, id: string, hint = -1): number {
  const cells = doc.cells;
  if (!cells) return -1;
  if (hint >= 0 && hint < cells.length && readString(cells[hint].id) === id) {
    return hint;
  }
  for (let i = 0; i < cells.length; i++) {
    if (readString(cells[i].id) === id) return i;
  }
  return -1;
}

/** Automerge list proxies expose insertAt/deleteAt, which plain array types lack. */
export function asList(list: unknown[]): { insertAt(index: number, ...values: unknown[]): void; deleteAt(index: number, count?: number): void } {
  return list as any;
}

export function sourcePath(index: number): Prop[] {
  return ['cells', index, 'source'];
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
