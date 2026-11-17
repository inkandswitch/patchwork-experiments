import type { Doc, Heads, Patch } from '@automerge/automerge';
import { automerge } from './model/automerge';
import { jsonEqual, readString, toPlain } from './model/json';
import type { CellDoc, NotebookDoc } from './model/schema';

/** What changed in a notebook since a baseline. Cells are matched by id, so moving a cell is not a change. */
export type NotebookDiff = {
  /** Cells that were added or changed, keyed by id. */
  cells: Map<string, CellDiff>;
  deleted: DeletedCell[];
};

export type CellDiff =
  | { type: 'added' }
  | {
      type: 'changed';
      /** The source, cell type or metadata changed. */
      input: boolean;
      outputs: boolean;
      /** Edits to the source, in the current source's positions. */
      source: SourceChange[];
    };

export type SourceChange = { type: 'added'; from: number; to: number } | { type: 'deleted'; at: number; text: string };

export type DeletedCell = {
  id: string;
  cellType: string;
  source: string;
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
  const input =
    oldSource !== newSource ||
    readString(before.cell_type) !== readString(after.cell_type) ||
    !jsonEqual(toPlain(before.metadata ?? {}), toPlain(after.metadata ?? {}));
  const outputs = !jsonEqual(toPlain(before.outputs ?? []), toPlain(after.outputs ?? []));
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

function deletedCells(before: CellDoc[], after: CellDoc[]): DeletedCell[] {
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
    const entry: DeletedCell = { id, cellType: readString(cell.cell_type), source: readString(cell.source), before: null };
    deleted.push(entry);
    pending.push(entry);
  }
  return deleted;
}

/**
 * What the other draft changed, placed in this notebook, which has none of
 * those changes. Cells it added show as ghosts where it put them, in front
 * of the next cell this notebook also has.
 */
export type TheirChanges = {
  /** Cells this notebook has that the other draft changed. */
  changed: Map<string, { input: boolean; outputs: boolean }>;
  /** Cells this notebook still has that the other draft deleted. */
  deleted: Set<string>;
  added: DeletedCell[];
};

/** `diff` is the other draft's notebook `theirs` diffed against where the two forked. */
export function theirChanges(ours: Doc<NotebookDoc>, theirs: Doc<NotebookDoc>, diff: NotebookDiff): TheirChanges {
  const here = new Set((ours.cells ?? []).map(cell => readString(cell.id)));
  const changed = new Map<string, { input: boolean; outputs: boolean }>();
  for (const [id, change] of diff.cells) {
    if (change.type === 'changed' && here.has(id)) changed.set(id, { input: change.input, outputs: change.outputs });
  }
  const deleted = new Set(diff.deleted.map(cell => cell.id).filter(id => here.has(id)));
  const added: DeletedCell[] = [];
  let next: string | null = null;
  const cells = theirs.cells ?? [];
  for (let index = cells.length - 1; index >= 0; index--) {
    const cell = cells[index];
    const id = readString(cell.id);
    if (here.has(id)) {
      next = id;
    } else if (diff.cells.get(id)?.type === 'added') {
      added.unshift({ id, cellType: readString(cell.cell_type), source: readString(cell.source), before: next });
    }
  }
  return { changed, deleted, added };
}
