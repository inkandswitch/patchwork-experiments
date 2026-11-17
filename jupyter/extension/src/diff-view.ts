import type { DocHandle } from '@automerge/automerge-repo';
import type { NotebookPanel } from '@jupyterlab/notebook';
import { type ISignal, Signal } from '@lumino/signaling';
import type { Doc } from '@automerge/automerge';
import type { Baseline, Comparison } from './bridge';
import { notebookDiff, theirChanges, type CellDiff, type DeletedCell, type NotebookDiff, type TheirChanges } from './diff';
import { parseDocumentId } from './drive';
import { type AutomergeCell, AutomergeNotebook, type NotebookDoc } from './model';

/** Long enough to coalesce a burst of typing into one diff. */
const RECOMPUTE_DELAY_MS = 150;

/**
 * Keeps the diffs of the tool's notebook current while its draft is compared
 * with another: its own changes since the two forked, and in the `drafts`
 * marks, the other draft's too.
 */
export class DiffTracker {
  constructor(handle: DocHandle<NotebookDoc>, baseline: Baseline) {
    this.documentId = handle.documentId;
    this._handle = handle;
    this._baseline = baseline;
    handle.on('change', this._schedule);
    baseline.subscribe(this._recompute);
    this._recompute();
  }

  readonly documentId: string;

  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /** This notebook's changes, null when nothing is marked. */
  get diff(): NotebookDiff | null {
    return this._diff;
  }

  /** The other draft's changes, while both drafts' are marked. */
  get theirs(): TheirChanges | null {
    return this._theirs;
  }

  get comparison(): Comparison | null {
    return this._diff ? this._comparison : null;
  }

  /** Whether cells the diffs don't touch are folded away. */
  get collapsed(): boolean {
    return this._diff !== null && !!this._comparison?.collapsed;
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
    clearTimeout(this._timer);
    const comparison = this._baseline.current();
    const doc = this._handle.doc();
    this._comparison = comparison;
    try {
      this._diff = comparison && doc ? notebookDiff(doc, comparison.ancestor) : null;
      const other = comparison?.marks === 'drafts' ? comparison.other : null;
      const theirs = other && this._diff ? this._theirsDiff(other, comparison!) : null;
      this._theirs = theirs && doc ? theirChanges(doc, other!, theirs) : null;
    } catch (error) {
      console.warn("[jupyter] couldn't diff the notebook", error);
      this._diff = null;
      this._theirs = null;
    }
    this._changed.emit();
  };

  /** The other draft's version only changes with the comparison, so its diff is kept until then. */
  private _theirsDiff(other: Doc<NotebookDoc>, comparison: Comparison): NotebookDiff | null {
    const key = comparison.ancestor.join(',');
    if (this._theirsCache?.other !== other || this._theirsCache.key !== key) {
      this._theirsCache = { other, key, diff: notebookDiff(other, comparison.ancestor) };
    }
    return this._theirsCache.diff;
  }

  private _baseline: Baseline;
  private _changed = new Signal<this, void>(this);
  private _comparison: Comparison | null = null;
  private _diff: NotebookDiff | null = null;
  private _handle: DocHandle<NotebookDoc>;
  private _notebooks = new WeakSet<AutomergeNotebook>();
  private _theirs: TheirChanges | null = null;
  private _theirsCache: { other: Doc<NotebookDoc>; key: string; diff: NotebookDiff | null } | null = null;
  private _timer: ReturnType<typeof setTimeout> | undefined;
}

/** Mark the changes in `panel`, and where cells were deleted or added elsewhere, if it shows the tracked notebook. */
export function showDiffs(panel: NotebookPanel, diffs: DiffTracker): void {
  const shared = panel.context.model.sharedModel;
  if (!(shared instanceof AutomergeNotebook) || parseDocumentId(panel.context.path) !== diffs.documentId) return;
  const pending = new WeakSet<Cell>();
  const apply = () => {
    if (panel.isDisposed) return;
    const comparison = diffs.comparison;
    const drafts = comparison?.marks === 'drafts';
    panel.content.toggleClass('pw-diff-drafts', drafts);
    showColors(panel.content.node, drafts ? comparison.colors : {});
    renderCellDiffs(panel.content.widgets, diffs, cell => {
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

/** The iframe doesn't inherit the page's custom properties, so the drafts' colours are copied in. */
function showColors(node: HTMLElement, colors: Comparison['colors']): void {
  for (const draft of ['ours', 'theirs'] as const) {
    const color = colors[draft];
    if (color) node.style.setProperty(`--compare-${draft}`, color);
    else node.style.removeProperty(`--compare-${draft}`);
  }
}

/** Cells shown in place of a cell, in its header, or after the last one, in its footer. */
type Badge =
  | { kind: 'deleted' | 'added'; by: 'ours' | 'theirs' | null; cells: DeletedCell[] }
  | { kind: 'removed'; by: 'theirs' };

/**
 * `notReady` is called with cells still waiting to build their header and
 * footer. Folding keeps the cells that show where others were deleted or
 * added.
 */
function renderCellDiffs(cells: readonly Cell[], diffs: DiffTracker, notReady: (cell: Cell) => void): void {
  const diff = diffs.diff;
  const theirs = diffs.theirs;
  const drafts = diffs.comparison?.marks === 'drafts';
  const names = diffs.comparison?.names;
  const badges = new Map<string | null, Badge[]>();
  const add = (before: string | null, badge: Badge) => badges.set(before, [...(badges.get(before) ?? []), badge]);
  for (const [before, group] of groupBy(diff?.deleted ?? [])) add(before, { kind: 'deleted', by: drafts ? 'ours' : null, cells: group });
  for (const [before, group] of groupBy(theirs?.added ?? [])) add(before, { kind: 'added', by: 'theirs', cells: group });
  for (const id of theirs?.deleted ?? []) add(id, { kind: 'removed', by: 'theirs' });

  cells.forEach((cell, index) => {
    const id = cell.model.id;
    const change = diff?.cells.get(id);
    const theirChange = theirs?.changed.get(id);
    const last = index === cells.length - 1;
    const marked = !!change || !!theirChange || badges.has(id) || (last && badges.has(null));
    cell.toggleClass('pw-diff-folded', diffs.collapsed && !marked);
    cell.toggleClass('pw-diff-added', change?.type === 'added');
    cell.toggleClass('pw-diff-changed', change?.type === 'changed' && change.input);
    cell.toggleClass('pw-diff-outputs', change?.type === 'changed' && change.outputs);
    cell.toggleClass('pw-diff-theirs-changed', !!theirChange?.input);
    cell.toggleClass('pw-diff-theirs-outputs', !!theirChange?.outputs);
    cell.toggleClass('pw-diff-theirs-deleted', !!theirs?.deleted.has(id));
    const header = cell.node.querySelector(':scope > .jp-Cell-header');
    const footer = cell.node.querySelector(':scope > .jp-Cell-footer');
    if (!header || !footer) return notReady(cell);
    showBadges(header, badges.get(id) ?? [], names);
    showBadges(footer, last ? (badges.get(null) ?? []) : [], names);
  });
}

function groupBy(cells: DeletedCell[]): Map<string | null, DeletedCell[]> {
  const groups = new Map<string | null, DeletedCell[]>();
  for (const cell of cells) groups.set(cell.before, [...(groups.get(cell.before) ?? []), cell]);
  return groups;
}

/** Keeps badges that didn't change, so one that is open stays open while the rest of the diff updates. */
function showBadges(host: Element, badges: Badge[], names: Comparison['names'] | undefined): void {
  const keyed = badges.map(badge => ({ badge, key: badgeKey(badge, names) }));
  const current = [...host.querySelectorAll<HTMLElement>(':scope > .pw-diff-badge')];
  if (current.map(node => node.dataset.key).join('\n') === keyed.map(({ key }) => key).join('\n')) return;
  const kept = new Map(current.map(node => [node.dataset.key, node]));
  for (const node of current) node.remove();
  for (const { badge, key } of keyed) host.append(kept.get(key) ?? badgeElement(badge, key, names));
}

function badgeKey(badge: Badge, names: Comparison['names'] | undefined): string {
  const cells = badge.kind === 'removed' ? '' : badge.cells.map(cell => cell.id).join(' ');
  return `${badge.kind} ${badge.by ?? ''} ${badge.by ? (names?.[badge.by] ?? '') : ''} ${cells}`;
}

function badgeElement(badge: Badge, key: string, names: Comparison['names'] | undefined): HTMLElement {
  const draft = badge.by && (names?.[badge.by] || (badge.by === 'ours' ? 'this draft' : 'the other draft'));
  if (badge.kind === 'removed') {
    const label = document.createElement('div');
    label.className = 'pw-diff-badge pw-diff-removed pw-diff-by-theirs';
    label.dataset.key = key;
    label.textContent = `Deleted in ${draft}`;
    return label;
  }
  const element = document.createElement('details');
  element.className = `pw-diff-badge pw-diff-${badge.kind}`;
  if (badge.by) element.classList.add(`pw-diff-by-${badge.by}`);
  element.dataset.key = key;
  const summary = document.createElement('summary');
  const count = badge.cells.length === 1 ? '1' : String(badge.cells.length);
  const noun = badge.cells.length === 1 ? 'cell' : 'cells';
  summary.textContent = draft ? `${count} ${noun} ${badge.kind} in ${draft}` : `${count} ${badge.kind} ${noun}`;
  element.append(summary);
  for (const cell of badge.cells) {
    const source = document.createElement('pre');
    source.dataset.cellType = cell.cellType;
    source.textContent = cell.source || 'empty cell';
    source.classList.toggle('pw-diff-empty', !cell.source);
    element.append(source);
  }
  return element;
}
