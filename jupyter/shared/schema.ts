import type * as nbformat from '@jupyterlab/nbformat';

/**
 * The Automerge document mirrors nbformat. Cell `source` and stream output
 * `text` are collaborative text; every other string is an ImmutableString.
 */
export type NotebookDoc = {
  title?: string;
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: Record<string, any>;
  cells?: CellDoc[];
};

export type CellDoc = {
  id: string;
  cell_type: string;
  source: string;
  metadata: Record<string, any>;
  outputs?: Array<Record<string, any>>;
  execution_count?: number | null;
  attachments?: Record<string, any>;
};

export type CellJSON = Partial<nbformat.ICell> & { cell_type: string; id?: string };
