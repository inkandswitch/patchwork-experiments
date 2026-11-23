import type { Doc, Heads, Patch } from '@automerge/automerge';
import { automerge } from '../../../shared/automerge';
import { jsonEqual, readString, toPlain } from '../../../shared/json';
import type { CellDoc, NotebookDoc } from '../../../shared/schema';

/**
 * What one draft changed in a notebook since a baseline, the version it
 * parted from the draft it's compared with. Cells are matched by id, so
 * moving a cell is not a change.
 */
export type NotebookDiff = {
  /** Cells that were added or changed, keyed by id. */
  cells: Map<string, CellDiff>;
  deleted: DeletedCell[];
};

export type CellDiff =
  | { type: 'added' }
  | {
      type: 'changed';
      /** The source or cell type changed. Metadata alone doesn't show, so it doesn't count. */
      input: boolean;
      outputs: boolean;
      /** Edits to the source, in the current source's positions. */
      source: SourceChange[];
    };

export type SourceChange = { type: 'added'; from: number; to: number } | { type: 'deleted'; at: number; text: string };

/** A cell one version has and the other doesn't, placed where it would be. */
export type DeletedCell = {
  id: string;
  cellType: string;
  source: string;
  outputs: unknown[];
  /** The id of the surviving cell it was deleted from in front of; null when it was after all of them. */
  before: string | null;
};

/** Null when the baseline isn't in the document's history (yet). */
export function notebookDiff(doc: Doc<NotebookDoc>, baseline: Heads): NotebookDiff | null {
  const A = automerge();
  if (!A.hasHeads(doc, baseline)) return null;
  const heads = A.getHeads(doc);
  const before = A.view(doc, baseline);
  const beforeCells = new Map((before.cells ?? []).map(cell => [readString(cell.id), cell]));
  const cells = new Map<string, CellDiff>();
  (doc.cells ?? []).forEach((cell, index) => {
    const id = readString(cell.id);
    const old = beforeCells.get(id);
    const change = old ? cellChange(old, cell, () => A.diffPath(doc, ['cells', index], baseline, heads)) : { type: 'added' as const };
    if (change) cells.set(id, change);
  });
  return { cells, deleted: deletedCells(before.cells ?? [], doc.cells ?? []) };
}

/**
 * `patches` are the cell's Automerge patches, only meaningful when both
 * versions are the same object, i.e. the cell was edited in place rather
 * than moved (which copies it).
 */
function cellChange(before: CellDoc, after: CellDoc, patches: () => Patch[]): CellDiff | null {
  const A = automerge();
  const inPlace = A.getObjectId(before) === A.getObjectId(after);
  const cellPatches = inPlace ? patches() : null;
  if (cellPatches?.length === 0) return null;

  const oldSource = readString(before.source);
  const newSource = readString(after.source);
  const input = oldSource !== newSource || readString(before.cell_type) !== readString(after.cell_type);
  const outputs = !jsonEqual(shownOutputs(before.outputs), shownOutputs(after.outputs));
  if (!input && !outputs) return null;

  const textId = A.getObjectId(after, 'source');
  let source: SourceChange[] = [];
  if (oldSource !== newSource) {
    source =
      cellPatches && textId !== null && textId === A.getObjectId(before, 'source')
        ? textChanges(cellPatches, oldSource)
        : replacedText(oldSource, newSource);
  }
  return { type: 'changed', input, outputs, source };
}

/**
 * Text patches come in order with positions in the current text. A deletion's
 * text isn't in its patch, so track how far the current text has shifted
 * from the old one to read it back out.
 */
function textChanges(patches: Patch[], oldSource: string): SourceChange[] {
  const changes: SourceChange[] = [];
  let shift = 0;
  for (const patch of patches) {
    const [, , field, pos] = patch.path;
    if (field !== 'source' || typeof pos !== 'number' || patch.path.length !== 4) continue;
    if (patch.action === 'splice') {
      changes.push({ type: 'added', from: pos, to: pos + patch.value.length });
      shift -= patch.value.length;
    } else if (patch.action === 'del') {
      const length = patch.length ?? 1;
      changes.push({ type: 'deleted', at: pos, text: oldSource.slice(pos + shift, pos + shift + length) });
      shift += length;
    }
  }
  return changes;
}

/** Without shared history to go by, everything between the common prefix and suffix changed. */
function replacedText(oldSource: string, newSource: string): SourceChange[] {
  let prefix = 0;
  const shortest = Math.min(oldSource.length, newSource.length);
  while (prefix < shortest && oldSource[prefix] === newSource[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    oldSource[oldSource.length - 1 - suffix] === newSource[newSource.length - 1 - suffix]
  ) {
    suffix++;
  }
  const changes: SourceChange[] = [];
  if (oldSource.length - suffix > prefix) {
    changes.push({ type: 'deleted', at: prefix, text: oldSource.slice(prefix, oldSource.length - suffix) });
  }
  if (newSource.length - suffix > prefix) {
    changes.push({ type: 'added', from: prefix, to: newSource.length - suffix });
  }
  return changes;
}

/**
 * Outputs as they show, to tell whether two cells' outputs differ: without
 * the execution count an `execute_result` carries (a re-run that gives the
 * same result isn't a change), with stream output that arrived in pieces
 * joined, and multiline strings as one.
 */
export function shownOutputs(outputs: unknown): unknown[] {
  const shown: Record<string, unknown>[] = [];
  for (const output of toPlain<Record<string, unknown>[]>(outputs ?? [])) {
    const { execution_count: _count, ...rest } = output;
    if (rest.data && typeof rest.data === 'object') {
      rest.data = Object.fromEntries(Object.entries(rest.data).map(([mime, value]) => [mime, joined(value)]));
    }
    if (rest.output_type === 'stream') {
      const text = joined(rest.text);
      const last = shown[shown.length - 1];
      if (last?.output_type === 'stream' && last.name === rest.name) {
        last.text = `${last.text}${text}`;
        continue;
      }
      rest.text = text;
    }
    shown.push(rest);
  }
  return shown;
}

function joined(value: unknown): unknown {
  return Array.isArray(value) && value.every(line => typeof line === 'string') ? value.join('') : value;
}

/** The cells of `before` that `after` doesn't have, each anchored to the next cell both have. */
export function deletedCells(before: CellDoc[], after: CellDoc[]): DeletedCell[] {
  const surviving = new Set(after.map(cell => readString(cell.id)));
  const deleted: DeletedCell[] = [];
  let pending: DeletedCell[] = [];
  for (const cell of before) {
    const id = readString(cell.id);
    if (surviving.has(id)) {
      for (const cell of pending) cell.before = id;
      pending = [];
      continue;
    }
    const entry: DeletedCell = {
      id,
      cellType: readString(cell.cell_type),
      source: readString(cell.source),
      outputs: toPlain(cell.outputs ?? []),
      before: null,
    };
    deleted.push(entry);
    pending.push(entry);
  }
  return deleted;
}
