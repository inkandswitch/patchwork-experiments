import type { DocHandle } from '@automerge/automerge-repo';
import type { NotebookPanel } from '@jupyterlab/notebook';
import { type ISignal, Signal } from '@lumino/signaling';
import type { Baseline } from './bridge';
import { notebookDiff, type CellDiff, type DeletedCell, type NotebookDiff } from './diff';
import { parseDocumentId } from './drive';
import { type AutomergeCell, AutomergeNotebook, type NotebookDoc } from './model';

/** Long enough to coalesce a burst of typing into one diff. */
const RECOMPUTE_DELAY_MS = 150;

/** Keeps the diff of the tool's notebook against its baseline current. */
export class DiffTracker {
  constructor(handle: DocHandle<NotebookDoc>, baseline: Baseline) {
    this.documentId = handle.documentId;
    this._handle = handle;
    this._baseline = baseline;
    handle.on('change', this._schedule);
    baseline.subscribe(this._schedule);
    this._recompute();
  }

  readonly documentId: string;

  get changed(): ISignal<this, void> {
    return this._changed;
  }

  get diff(): NotebookDiff | null {
    return this._diff;
  }

  /** Whether cells the diff doesn't touch are folded away. */
  get collapsed(): boolean {
    return this._diff !== null && this._baseline.collapsed();
  }

  /** Diff `notebook`'s cells, as it shows the tracked document. */
  watch(notebook: AutomergeNotebook): void {
    this._notebooks.add(notebook);
    this._changed.emit();
  }

  cellDiff(cell: AutomergeCell): CellDiff | undefined {
    const notebook = cell.notebook;
    if (!notebook || !this._notebooks.has(notebook)) return undefined;
    return this._diff?.cells.get(cell.id);
  }

  private _schedule = () => {
    clearTimeout(this._timer);
    this._timer = setTimeout(this._recompute, RECOMPUTE_DELAY_MS);
  };

  private _recompute = () => {
    const heads = this._baseline.current();
    const doc = this._handle.doc();
    try {
      this._diff = heads && doc ? notebookDiff(doc, heads) : null;
    } catch (error) {
      console.warn("[jupyter] couldn't diff the notebook", error);
      this._diff = null;
    }
    this._changed.emit();
  };

  private _baseline: Baseline;
  private _changed = new Signal<this, void>(this);
  private _diff: NotebookDiff | null = null;
  private _handle: DocHandle<NotebookDoc>;
  private _notebooks = new WeakSet<AutomergeNotebook>();
  private _timer: ReturnType<typeof setTimeout> | undefined;
}

/** Mark added and changed cells in `panel`, and where cells were deleted, if it shows the tracked notebook. */
export function showDiffs(panel: NotebookPanel, diffs: DiffTracker): void {
  const shared = panel.context.model.sharedModel;
  if (!(shared instanceof AutomergeNotebook) || parseDocumentId(panel.context.path) !== diffs.documentId) return;
  const pending = new WeakSet<Cell>();
  const apply = () => {
    if (panel.isDisposed) return;
    renderCellDiffs(panel.content.widgets, diffs.diff, diffs.collapsed, cell => {
      if (pending.has(cell)) return;
      pending.add(cell);
      void cell.ready.then(later);
    });
  };
  const later = () => queueMicrotask(apply);
  diffs.changed.connect(later);
  panel.content.model?.cells.changed.connect(later);
  panel.disposed.connect(() => diffs.changed.disconnect(later));
  diffs.watch(shared);
}

type Cell = NotebookPanel['content']['widgets'][number];

/**
 * `notReady` is called with cells still waiting to build their header and
 * footer. Folding keeps the cells that show where others were deleted.
 */
function renderCellDiffs(
  cells: readonly Cell[],
  diff: NotebookDiff | null,
  collapsed: boolean,
  notReady: (cell: Cell) => void
): void {
  const deletedBefore = new Map<string | null, DeletedCell[]>();
  for (const cell of diff?.deleted ?? []) {
    deletedBefore.set(cell.before, [...(deletedBefore.get(cell.before) ?? []), cell]);
  }
  cells.forEach((cell, index) => {
    const change = diff?.cells.get(cell.model.id);
    const marksDeleted =
      deletedBefore.has(cell.model.id) || (index === cells.length - 1 && deletedBefore.has(null));
    cell.toggleClass('pw-diff-folded', collapsed && !change && !marksDeleted);
    cell.toggleClass('pw-diff-added', change?.type === 'added');
    cell.toggleClass('pw-diff-changed', change?.type === 'changed' && change.input);
    cell.toggleClass('pw-diff-outputs', change?.type === 'changed' && change.outputs);
    const header = cell.node.querySelector(':scope > .jp-Cell-header');
    const footer = cell.node.querySelector(':scope > .jp-Cell-footer');
    if (!header || !footer) return notReady(cell);
    showDeleted(header, deletedBefore.get(cell.model.id));
    showDeleted(footer, index === cells.length - 1 ? deletedBefore.get(null) : undefined);
  });
}

/** Keeps an unchanged badge, so one that is open stays open while the rest of the diff updates. */
function showDeleted(host: Element, cells: DeletedCell[] | undefined): void {
  const key = cells?.map(cell => cell.id).join(' ') ?? '';
  const current = host.querySelector<HTMLElement>(':scope > .pw-diff-deleted');
  if ((current?.dataset.cells ?? '') === key) return;
  current?.remove();
  if (cells?.length) host.append(deletedBadge(cells, key));
}

function deletedBadge(cells: DeletedCell[], key: string): HTMLElement {
  const badge = document.createElement('details');
  badge.className = 'pw-diff-deleted';
  badge.dataset.cells = key;
  const summary = document.createElement('summary');
  summary.textContent = cells.length === 1 ? '1 deleted cell' : `${cells.length} deleted cells`;
  badge.append(summary);
  for (const cell of cells) {
    const source = document.createElement('pre');
    source.dataset.cellType = cell.cellType;
    source.textContent = cell.source || 'empty cell';
    source.classList.toggle('pw-diff-empty', !cell.source);
    badge.append(source);
  }
  return badge;
}
