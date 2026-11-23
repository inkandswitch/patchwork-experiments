// The state behind the UI: the document, its evaluation, the filters and the selection.

import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext } from 'solid-js';
import type { AmbsheetDoc, AmbsheetHandle } from '../datatype';
import { DEFAULT_COLS } from '../datatype';
import { moveRefs, shiftAddr, type StructuralEdit } from '../lang/rewrite';
import { MAX_COLS, addrOf, valueKey, type Pos, type RawValue } from '../lang/values';
import { cellText, compileSheet, type CellInfo } from '../model/compile';
import {
  countMatching,
  isFiltering,
  passMask,
  summarize,
  type Filter,
  type Summary,
  type View,
} from '../model/analysis';
import { Focuser, type Focus } from '../model/focus';
import { createAssist } from './assistState';
import { applyEdit, checkEdit } from '../model/structure';
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

  /** Writes cell texts, in one change. */
  function setCells(updates: { row: number; col: number; text: string }[]) {
    const changed = updates.filter(
      (u) => u.col < MAX_COLS && u.row >= 0 && u.col >= 0 && cellText(data(), u.row, u.col) !== u.text,
    );
    if (changed.length === 0) return;
    handle.change((d) => {
      if (!Array.isArray(d.data)) d.data = [];
      for (const { row, col, text } of changed) {
        while (d.data.length <= row) d.data.push(new Array(numCols() || DEFAULT_COLS).fill(null));
        while (d.data[row].length <= col) d.data[row].push(null);
        d.data[row][col] = text === '' ? null : text;
      }
    });
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

  const [filters, setFilters] = createSignal<ReadonlyMap<string, Filter>>(new Map());
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
    for (const info of r.compiled.varying) result.set(info.addr, summarize(info, v));
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

  function structuralEdit(edit: StructuralEdit) {
    if (whyNot(edit) !== null) return;
    setEdit(null);
    handle.change((d) => applyEdit(d.data, edit));

    // The filters follow their cells.
    const moved = new Map<string, Filter>();
    for (const [addr, filter] of filters()) {
      const to = shiftAddr(addr, edit);
      if (to !== null) moved.set(to, filter);
    }
    setFilters(moved);
    setHover(null);

    // And the selection stays where it was on screen, within the sheet.
    const sel = selection();
    const row = Math.max(0, Math.min(numRows() - 1, Math.min(sel.row, sel.row2)));
    const col = Math.max(0, Math.min(numCols() - 1, Math.min(sel.col, sel.col2)));
    setSelection({ row, col, row2: row, col2: col, quiet: true });
  }

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
    view,
    filtering,
    passing,
    focus,
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
