import type { Prop } from '@automerge/automerge';
import type * as nbformat from '@jupyterlab/nbformat';
import { realm } from './automerge';
import { jsonCopy, readString, toAutomerge } from './json';
import type { CellJSON, NotebookDoc } from './schema';

/**
 * The notebook document format both Jupyter tools share: converting nbformat
 * JSON into it, and finding things in it.
 */

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
  const clone = jsonCopy(metadata);
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
