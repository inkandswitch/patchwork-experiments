// The state behind the UI: the document, its evaluation, the filters and the selection.

import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext } from 'solid-js';
import type { AmbsheetDoc, AmbsheetHandle } from '../datatype';
import { moveRefs, shiftAddr, type StructuralEdit } from '../lang/rewrite';
import { MAX_COLS, addrOf, valueKey, type Pos, type RawValue } from '../lang/values';
import { cellText, compileSheet, type AmbInfo, type CellInfo } from '../model/compile';
import {
  countMatching,
  isFiltering,
  passMask,
  summarize,
  type Filter,
  type Summary,
  type View,
} from '../model/analysis';
import { ExactCounter, canCountExactly, type ExactCount } from '../model/exact';
import { Focuser, type Focus } from '../model/focus';
import { decodeFilters, encodeFilters, filtersSignature } from '../model/savedFilters';
import { createAssist } from './assistState';
import { History, type Change } from '../model/history';
import { checkEdit } from '../model/structure';
import {
  DEFAULT_SETTINGS,
  Evaluation,
  Runner,
  SAMPLE_SIZES,
  type EvalMode,
  type EvalSettings,
  type Run,
} from '../model/run';

export interface Selection {
  /** The active cell... */
  row: number;
  col: number;
  /** ...and the opposite corner of the selected range (the same cell if there is no range). */
  row2: number;
  col2: number;
  /** Set when a whole row or column was selected, which shouldn't scroll the grid. */
  quiet?: boolean;
}

/** A block of cells. */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The menu for inserting and deleting rows and columns, and where it is (in the tool). */
export interface ContextMenu {
  x: number;
  y: number;
  rows: boolean;
  cols: boolean;
}

export interface Edit {
  addr: string;
  text: string;
  /** Where the text is being typed: in the cell, or in the formula bar. */
  where: 'cell' | 'bar';
}

/** How long after the filters change they are written to the document. */
const SAVE_FILTERS_AFTER_MS = 400;

/** Look for matching scenarios when a sample has fewer than this many of them... */
const FOCUS_BELOW = 1_000;
/** ...and collect up to this many. */
const FOCUS_TARGET = 20_000;

export type SheetState = ReturnType<typeof createSheetState>;

export function createSheetState(handle: AmbsheetHandle) {
  // --- the document ---

  const [doc, setDoc] = createSignal<AmbsheetDoc | undefined>(handle.doc(), { equals: false });
  const onChange = () => setDoc(() => handle.doc());
  handle.on('change', onChange);
  onCleanup(() => handle.off('change', onChange));

  // Automerge keeps unchanged parts of a document identical from one version to the next,
  // so this memo (and the compilation that hangs off it) only reruns when cells change.
  const data = createMemo(() => doc()?.data);
  const numRows = createMemo(() => data()?.length ?? 0);
  const numCols = createMemo(() => {
    let cols = 0;
    for (const row of data() ?? []) cols = Math.max(cols, row?.length ?? 0);
    return Math.min(cols, MAX_COLS);
  });
  const text = (pos: Pos) => cellText(data(), pos.row, pos.col);

  // Every change to the cells goes through the history, which is what makes undo work.
  const history = new History({
    data: () => handle.doc()?.data ?? [],
    change: (fn) =>
      handle.change((d) => {
        if (!Array.isArray(d.data)) d.data = [];
        fn(d.data);
      }),
  });
  /** (bumped whenever the history changes, since the history itself isn't reactive) */
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const canUndo = () => (historyVersion(), history.canUndo);
  const canRedo = () => (historyVersion(), history.canRedo);

  /** Writes cell texts, in one change (and one step of undo). */
  function setCells(updates: { row: number; col: number; text: string }[]) {
    history.setCells(updates);
    setHistoryVersion((v) => v + 1);
  }

  // --- evaluation ---

  const [seed, setSeed] = createSignal(DEFAULT_SETTINGS.seed);
  const mode = createMemo<EvalMode>(() => {
    const m = doc()?.evaluation?.mode;
    return m === 'exhaustive' || m === 'montecarlo' ? m : 'auto';
  });
  const samples = createMemo(() => {
    const n = doc()?.evaluation?.samples;
    return typeof n === 'number' && n >= 1 ? Math.floor(n) : DEFAULT_SETTINGS.samples;
  });
  const settings = (): EvalSettings => ({ mode: mode(), samples: samples(), seed: seed() });

  const compiled = createMemo(() => compileSheet(data()));

  const [run, setRun] = createSignal<Run>(
    new Evaluation(untrack(compiled), untrack(settings)).run,
  );
  const runner = new Runner(setRun);
  onCleanup(() => runner.stop());
  // Any change to the cells or to the settings starts the evaluation over. The first
  // slice of work happens right here, so small sheets are up to date immediately; bigger
  // ones keep publishing results as they go.
  createEffect(() => runner.start(compiled(), settings()));

  function setEvaluation(changes: { mode?: EvalMode; samples?: number }) {
    handle.change((d) => {
      if (!d.evaluation) d.evaluation = {};
      if (changes.mode !== undefined) d.evaluation.mode = changes.mode;
      if (changes.samples !== undefined) d.evaluation.samples = changes.samples;
    });
  }

  // --- filters ---

  // The filters are kept in the document, so they survive a reload and everyone looking
  // at the sheet sees the same ones. They are read from it whenever it changes, and
  // written to it a moment after they change here (a moment, so that dragging a slider
  // isn't a write per pixel).
  const [filters, setLocalFilters] = createSignal<ReadonlyMap<string, Filter>>(new Map());
  const savedSignature = createMemo(() => filtersSignature(decodeFilters(doc()?.filters)));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const saveFilters = () => {
    saveTimer = null;
    const current = untrack(filters);
    if (filtersSignature(current) === untrack(savedSignature)) return;
    handle.change((d) => {
      if (current.size > 0) d.filters = encodeFilters(current);
      else delete d.filters;
    });
  };

  const setFilters = (next: ReadonlyMap<string, Filter>) => {
    setLocalFilters(next);
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveFilters, SAVE_FILTERS_AFTER_MS);
  };

  createEffect(() => {
    // (the document's filters changed: loaded, or changed by someone else)
    if (savedSignature() === filtersSignature(untrack(filters))) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    setLocalFilters(decodeFilters(untrack(doc)?.filters));
  });

  onCleanup(() => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveFilters();
  });
  /** Temporary filters, in effect while the pointer is over something (a bar, a row...). */
  const [hover, setHover] = createSignal<ReadonlyMap<string, Filter> | null>(null);

  const effectiveFilters = createMemo(() => {
    const h = hover();
    return h ? new Map([...filters(), ...h]) : filters();
  });

  // --- focused sampling ---
  //
  // Filtering is instant: it just picks out the sampled scenarios that satisfy the
  // filters. But a Monte Carlo sample may contain very few of those, or none. When that
  // happens a second, focused evaluation goes looking for scenarios that do satisfy the
  // filters (see focus.ts), and as soon as it finds them they take over as "the
  // scenarios that match".

  const [focusEnabled, setFocusEnabled] = createSignal(true);
  const [focus, setFocus] = createSignal<Focus | null>(null);
  const focuser = new Focuser(setFocus);
  onCleanup(() => focuser.stop());

  /** True when the filters leave too little of a finished Monte Carlo sample to go on. */
  const scarce = createMemo(() => {
    const r = run();
    if (!focusEnabled() || !r.done || r.mode !== 'montecarlo' || r.n === 0) return false;
    const mask = passMask(r, filters());
    if (mask === null) return false;
    let count = 0;
    for (let i = 0; i < r.n && count < FOCUS_BELOW; i++) count += mask[i];
    return count < FOCUS_BELOW;
  });

  createEffect(() => {
    const [r, pinned, target, randomSeed] = [run(), filters(), Math.min(samples(), FOCUS_TARGET), seed()];
    focuser.stop();
    setFocus(null);
    if (!scarce()) return;
    // (a short wait, so that dragging a slider doesn't start a search at every step)
    const timer = setTimeout(() => focuser.start(r.compiled, pinned, { target, seed: randomSeed }), 150);
    onCleanup(() => clearTimeout(timer));
  });

  // --- a second opinion ---
  //
  // A sheet that is being sampled, but has few enough scenarios to visit them all, gets
  // the true number that match the filters counted in the background (see exact.ts).

  const [exact, setExact] = createSignal<ExactCount | null>(null);
  const exactCounter = new ExactCounter(setExact);
  onCleanup(() => exactCounter.stop());

  createEffect(() => {
    const [r, pinned] = [run(), filters()];
    exactCounter.stop();
    setExact(null);
    const relevant = [...pinned.keys()].some((id) => id in r.columns);
    if (!r.done || r.mode !== 'montecarlo' || !relevant || !canCountExactly(r.compiled)) return;
    const timer = setTimeout(() => exactCounter.start(r.compiled, pinned), 300);
    onCleanup(() => clearTimeout(timer));
  });

  const view = createMemo((): View => {
    const r = run();
    const f = focus();
    if (f && f.phase === 'sampling' && f.n > 0 && f.filters === filters()) {
      // Every scenario the focus found satisfies the filters; only hovering narrows them.
      const h = hover();
      return { all: r, matching: f, mask: h ? passMask(f, h) : null };
    }
    return { all: r, matching: r, mask: passMask(r, effectiveFilters()) };
  });
  const filtering = createMemo(() => isFiltering(view()));
  const passing = createMemo(() => countMatching(view()));
  /** The filters that apply to cells that (still) vary. */
  const activeFilters = createMemo(() => [...filters().keys()].filter((addr) => addr in run().columns));

  const summaries = createMemo(() => {
    const r = run();
    const v = view();
    const result = new Map<string, Summary>();
    for (const { id, spec } of r.compiled.subjects) result.set(id, summarize({ addr: id, spec }, v));
    return result;
  });

  function setFilter(addr: string, filter: Filter | null) {
    const next = new Map(filters());
    if (filter) next.set(addr, filter);
    else next.delete(addr);
    setFilters(next);
  }

  function toggleValue(addr: string, value: RawValue) {
    const key = valueKey(value);
    const current = filters().get(addr);
    const keys = new Set(current?.kind === 'values' ? current.keys : []);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    setFilter(addr, keys.size > 0 ? { kind: 'values', keys } : null);
  }

  const isValueSelected = (addr: string, key: string) => {
    const filter = filters().get(addr);
    return filter?.kind === 'values' && filter.keys.has(key);
  };

  const hoverValues = (addr: string, values: RawValue[]) =>
    setHover(new Map([[addr, { kind: 'values', keys: new Set(values.map(valueKey)) } as Filter]]));

  /**
   * Previews what the sheet looks like when some choices are made a certain way. (Only
   * for choices among values that are known up front.)
   */
  const hoverChoices = (choices: [AmbInfo, number][]) => {
    const preview = new Map<string, Filter>();
    for (const [amb, index] of choices) {
      if (amb.spec.kind !== 'discrete') continue;
      preview.set(amb.id, { kind: 'values', keys: new Set([valueKey(amb.spec.values[index])]) });
    }
    setHover(preview.size > 0 ? preview : null);
  };

  // --- selection and editing ---

  const [selection, setSelection] = createSignal<Selection>({ row: 0, col: 0, row2: 0, col2: 0 });
  const [edit, setEdit] = createSignal<Edit | null>(null);
  const activeAddr = createMemo(() => addrOf(selection()));
  const activeInfo = createMemo((): CellInfo | undefined => run().compiled.cells.get(activeAddr()));

  function select(pos: Pos, extend = false) {
    const row = Math.max(0, Math.min(numRows() - 1, pos.row));
    const col = Math.max(0, Math.min(numCols() - 1, pos.col));
    const s = selection();
    setSelection(extend ? { ...s, row2: row, col2: col } : { row, col, row2: row, col2: col });
  }

  const selectRow = (row: number) =>
    setSelection({ row, col: 0, row2: row, col2: Math.max(0, numCols() - 1), quiet: true });
  const selectCol = (col: number) =>
    setSelection({ row: 0, col, row2: Math.max(0, numRows() - 1), col2: col, quiet: true });

  const selectedRect = createMemo(() => {
    const s = selection();
    return {
      top: Math.min(s.row, s.row2),
      bottom: Math.max(s.row, s.row2),
      left: Math.min(s.col, s.col2),
      right: Math.max(s.col, s.col2),
    };
  });

  function beginEdit(where: Edit['where'], initialText?: string) {
    const s = selection();
    setSelection({ ...s, row2: s.row, col2: s.col });
    setEdit({ addr: activeAddr(), text: initialText ?? text(s), where });
  }

  function commitEdit() {
    const e = edit();
    if (!e) return;
    setEdit(null);
    const s = selection();
    if (e.addr === addrOf(s)) setCells([{ row: s.row, col: s.col, text: e.text }]);
  }

  const cancelEdit = () => setEdit(null);

  // --- help with formulas ---

  /** Completions and argument hints for the formula being typed. */
  const assist = createAssist({
    edit,
    setEdit,
    names: () =>
      [...run().compiled.cells.values()]
        .filter((info) => info.name !== null)
        .map((info) => ({ name: info.name!, addr: info.addr, text: text(info.pos) })),
  });

  /** What the side panel shows: the selected cell, or the reference. */
  const [panel, setPanel] = createSignal<'cell' | 'reference'>('cell');

  // --- filling ---

  const selectRect = (r: Rect) =>
    setSelection({ row: r.top, col: r.left, row2: r.bottom, col2: r.right, quiet: true });

  /**
   * Fills `target` with copies of the cells in `source` (which it contains), repeating
   * them like tiles. Formulas are adjusted for where they land: see moveRefs.
   */
  function fill(source: Rect, target: Rect) {
    const height = source.bottom - source.top + 1;
    const width = source.right - source.left + 1;
    const wrap = (offset: number, size: number) => ((offset % size) + size) % size;
    const updates = [];
    for (let row = target.top; row <= target.bottom; row++) {
      for (let col = target.left; col <= target.right; col++) {
        const from = {
          row: source.top + wrap(row - source.top, height),
          col: source.left + wrap(col - source.left, width),
        };
        if (from.row === row && from.col === col) continue;
        updates.push({ row, col, text: moveRefs(text(from), row - from.row, col - from.col) });
      }
    }
    setCells(updates);
  }

  /** Copies the top row of the selection down through it (or, for one cell, the cell above). */
  function fillDown() {
    const r = selectedRect();
    if (r.top < r.bottom) fill({ ...r, bottom: r.top }, r);
    else if (r.top > 0) fill({ ...r, top: r.top - 1, bottom: r.top - 1 }, { ...r, top: r.top - 1 });
  }

  /** Copies the left column of the selection across it (or, for one cell, the cell to its left). */
  function fillRight() {
    const r = selectedRect();
    if (r.left < r.right) fill({ ...r, right: r.left }, r);
    else if (r.left > 0) fill({ ...r, left: r.left - 1, right: r.left - 1 }, { ...r, left: r.left - 1 });
  }

  // --- inserting and deleting rows and columns ---

  const [menu, setMenu] = createSignal<ContextMenu | null>(null);

  /** Why a structural edit can't be made right now (null if it can). */
  const whyNot = (edit: StructuralEdit) => checkEdit(data() ?? [], edit);

  /** After rows or columns have moved: the filters follow their cells... */
  function afterStructuralEdit(edit: StructuralEdit) {
    const moved = new Map<string, Filter>();
    for (const [addr, filter] of filters()) {
      const to = shiftAddr(addr, edit);
      if (to !== null) moved.set(to, filter);
    }
    setFilters(moved);
    setHover(null);

    // ...and the selection stays where it was on screen, within the sheet.
    const sel = selection();
    const row = Math.max(0, Math.min(numRows() - 1, Math.min(sel.row, sel.row2)));
    const col = Math.max(0, Math.min(numCols() - 1, Math.min(sel.col, sel.col2)));
    setSelection({ row, col, row2: row, col2: col, quiet: true });
  }

  function structuralEdit(edit: StructuralEdit) {
    setEdit(null);
    if (history.structuralEdit(edit)) afterStructuralEdit(edit);
    setHistoryVersion((v) => v + 1);
  }

  // --- undo and redo ---

  /** After a change has been undone or redone: show where it was. */
  function afterTimeTravel(change: Change | null, undone: boolean) {
    setHistoryVersion((v) => v + 1);
    if (!change) return;
    setEdit(null);
    if (change.kind === 'structure') {
      const { edit } = change;
      afterStructuralEdit(undone ? { ...edit, kind: edit.kind === 'insert' ? 'delete' : 'insert' } : edit);
      return;
    }
    const rows = change.cells.map((c) => c.row);
    const cols = change.cells.map((c) => c.col);
    setSelection({
      row: Math.min(...rows),
      col: Math.min(...cols),
      row2: Math.min(Math.max(...rows), Math.max(0, numRows() - 1)),
      col2: Math.max(...cols),
    });
  }

  const undo = () => afterTimeTravel(history.undo(), true);
  const redo = () => afterTimeTravel(history.redo(), false);

  return {
    handle,
    doc,
    data,
    numRows,
    numCols,
    text,
    setCells,

    run,
    mode,
    samples,
    setEvaluation,
    resample: () => setSeed(Math.random()),
    sampleMore: () => runner.sampleMore(samples()),
    sampleSizes: SAMPLE_SIZES,

    filters,
    activeFilters,
    setFilter,
    clearFilters: () => setFilters(new Map()),
    toggleValue,
    isValueSelected,
    hover,
    setHover,
    hoverValues,
    hoverChoices,
    view,
    filtering,
    passing,
    focus,
    exact,
    focusEnabled,
    setFocusEnabled,
    summaries,

    selection,
    selectedRect,
    activeAddr,
    activeInfo,
    assist,
    panel,
    setPanel,
    select,
    selectRect,
    fill,
    fillDown,
    fillRight,
    selectRow,
    selectCol,
    menu,
    setMenu,
    whyNot,
    structuralEdit,
    undo,
    redo,
    canUndo,
    canRedo,
    edit,
    setEdit,
    beginEdit,
    commitEdit,
    cancelEdit,
  };
}

const SheetContext = createContext<SheetState>();
export const SheetProvider = SheetContext.Provider;

export function useSheet(): SheetState {
  const state = useContext(SheetContext);
  if (!state) throw new Error('no sheet state');
  return state;
}
