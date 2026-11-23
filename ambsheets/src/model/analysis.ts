// Reading results out of a run: filters, per-cell summaries, histograms and pivot tables.
//
// Unfiltered summaries come straight from amb-engine's running analysis, which is kept
// up to date as scenarios are evaluated and costs nothing to read. Anything that involves
// filters is computed here, from the scenarios the run has stored.

import { isRange, printValue, valueKey, type RangeValue, type RawValue } from '../lang/values';
import { ambKey, ambSize, choiceLabel, isContinuous, type CellInfo } from './compile';
import type { Run } from './run';

/** A filter keeps the scenarios in which a cell has one of some values, or is in a range. */
export type Filter =
  | { kind: 'values'; keys: ReadonlySet<string> }
  | { kind: 'range'; min: number; max: number; maxExclusive?: boolean };

/** Filters by cell address. A scenario has to satisfy all of them. */
export type Filters = ReadonlyMap<string, Filter>;

export function passes(filter: Filter, value: RawValue): boolean {
  if (filter.kind === 'values') return filter.keys.has(valueKey(value));
  return (
    typeof value === 'number' &&
    value >= filter.min &&
    (filter.maxExclusive ? value < filter.max : value <= filter.max)
  );
}

/**
 * Which scenarios satisfy the filters: mask[i] is 1 if scenario i does. Null means that
 * no filter applies, i.e. every scenario passes.
 */
export function passMask(run: Run, filters: Filters): Uint8Array | null {
  const active = [...filters].filter(([addr]) => addr in run.columns);
  if (active.length === 0) return null;
  const mask = new Uint8Array(run.n).fill(1);
  for (const [addr, filter] of active) {
    const column = run.columns[addr];
    for (let i = 0; i < run.n; i++) {
      if (mask[i] && !passes(filter, column[i])) mask[i] = 0;
    }
  }
  return mask;
}

export function countPassing(run: Run, mask: Uint8Array | null): number {
  if (!mask) return run.n;
  let count = 0;
  for (let i = 0; i < run.n; i++) count += mask[i];
  return count;
}

export interface Stats {
  count: number;
  avg: number;
  min: number;
  max: number;
}

export interface ValueCount {
  value: RawValue;
  key: string;
  /** How many scenarios have this value... */
  count: number;
  /** ...and how many of those satisfy the filters. */
  passing: number;
}

export interface Summary {
  /** Scenarios evaluated so far, and how many of them satisfy the filters. */
  n: number;
  passing: number;
  /** The distinct values of the cell. Null when there are too many to list. */
  values: ValueCount[] | null;
  /** Present when all of the cell's values are numbers. */
  stats: Stats | null;
  /** The same, over just the scenarios that satisfy the filters. */
  passingStats: Stats | null;
}

/** What to show for a varying cell, given the filters (as a mask). */
export function summarize(run: Run, info: CellInfo, mask: Uint8Array | null): Summary {
  const analysis = run.analysis[info.addr];
  const n = run.n;
  const stats: Stats | null = analysis?.stats && n > 0 ? { count: n, ...analysis.stats } : null;

  let passing = n;
  let passingStats = stats;
  let passingCounts: Map<any, number> | null = null;

  if (mask) {
    // One pass over the stored scenarios for everything that depends on the filters.
    const column = run.columns[info.addr];
    passingCounts = analysis?.histogram ? new Map() : null;
    passing = 0;
    let [sum, min, max] = [0, Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      passing++;
      const value = column[i];
      if (passingCounts) passingCounts.set(value, (passingCounts.get(value) ?? 0) + 1);
      if (stats) {
        sum += value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    passingStats = stats && passing > 0 ? { count: passing, avg: sum / passing, min, max } : null;
  }

  let values: ValueCount[] | null = null;
  if (analysis?.histogram) {
    values = [];
    for (const [value, count] of analysis.histogram) {
      values.push({
        value,
        key: valueKey(value),
        count,
        passing: passingCounts ? (passingCounts.get(value) ?? 0) : count,
      });
    }
    sortValues(values, info);
  }

  return { n, passing, values, stats, passingStats };
}

/**
 * Puts a cell's distinct values in a stable order, so they don't jump around while
 * samples are still arriving: an amb's values in the order they were written, numbers
 * ascending, and everything else alphabetically.
 */
function sortValues(values: ValueCount[], info: CellInfo) {
  if (info.spec?.kind === 'discrete') {
    const order = new Map<string, number>();
    info.spec.values.forEach((value, i) => {
      const key = valueKey(value);
      if (!order.has(key)) order.set(key, i);
    });
    values.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    return;
  }
  const rank = (v: RawValue) => (typeof v === 'number' ? 0 : typeof v === 'boolean' ? 1 : 2);
  values.sort((a, b) => {
    const [ra, rb] = [rank(a.value), rank(b.value)];
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.value as number) - (b.value as number);
    if (ra === 1) return Number(a.value) - Number(b.value);
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export interface Bin {
  x0: number;
  x1: number;
  count: number;
  passing: number;
}

export interface NumberSummary extends Stats {
  stdev: number;
}

export interface Histogram {
  bins: Bin[];
  min: number;
  max: number;
  all: NumberSummary;
  passing: NumberSummary | null;
}

/** A histogram of the numbers in a cell (ignoring any other values it has). */
export function histogram(
  run: Run,
  addr: string,
  mask: Uint8Array | null,
  numBins = 20,
): Histogram | null {
  const column = run.columns[addr];
  if (!column) return null;
  const n = run.n;

  const all = new Accumulator();
  const passing = new Accumulator();
  for (let i = 0; i < n; i++) {
    const value = column[i];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    all.add(value);
    if (!mask || mask[i]) passing.add(value);
  }
  if (all.count === 0) return null;

  const { min, max } = all;
  const width = (max - min) / numBins || 1;
  const bins: Bin[] = Array.from({ length: max === min ? 1 : numBins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
    passing: 0,
  }));
  for (let i = 0; i < n; i++) {
    const value = column[i];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    const bin = bins[Math.min(bins.length - 1, Math.floor((value - min) / width))];
    bin.count++;
    if (!mask || mask[i]) bin.passing++;
  }

  return { bins, min, max, all: all.summary()!, passing: passing.summary() };
}

class Accumulator {
  count = 0;
  sum = 0;
  sumOfSquares = 0;
  min = Infinity;
  max = -Infinity;

  add(value: number) {
    this.count++;
    this.sum += value;
    this.sumOfSquares += value * value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
  }

  summary(): NumberSummary | null {
    if (this.count === 0) return null;
    const avg = this.sum / this.count;
    const variance = Math.max(0, this.sumOfSquares / this.count - avg * avg);
    return { count: this.count, avg, min: this.min, max: this.max, stdev: Math.sqrt(variance) };
  }
}

export type Aggregation = 'avg' | 'sum' | 'count' | 'min' | 'max';

export interface PivotCell {
  /** Scenarios in this cell of the table, and how many of them satisfy the filters. */
  scenarios: number;
  passing: number;
  /** Aggregates over the numeric values of those scenarios. */
  count: number;
  sum: number;
  min: number;
  max: number;
}

export interface Pivot {
  xLabels: string[];
  /** A single unlabeled row when there is no second dimension. */
  yLabels: string[];
  /** cells[y][x] */
  cells: PivotCell[][];
}

/** The ambs a cell depends on that can serve as the axes of a table. */
export function tableDimensions(run: Run, info: CellInfo): CellInfo[] {
  return info.deps
    .map((addr) => run.compiled.cells.get(addr)!)
    .filter((dep) => dep?.spec && !isContinuous(dep.spec));
}

/** Breaks a cell's values down by the choices made in one or two ambs. */
export function pivot(
  run: Run,
  addr: string,
  mask: Uint8Array | null,
  x: CellInfo,
  y: CellInfo | null,
): Pivot {
  const xSize = ambSize(x.spec!);
  const ySize = y ? ambSize(y.spec!) : 1;
  const cells: PivotCell[][] = Array.from({ length: ySize }, () =>
    Array.from({ length: xSize }, () => ({
      scenarios: 0,
      passing: 0,
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
    })),
  );

  const column = run.columns[addr];
  const xs = run.columns[ambKey(x.addr)];
  const ys = y ? run.columns[ambKey(y.addr)] : null;
  for (let i = 0; i < run.n; i++) {
    const cell = cells[ys ? ys[i] : 0][xs[i]];
    cell.scenarios++;
    if (!mask || mask[i]) cell.passing++;
    const value = column[i];
    if (typeof value === 'number') {
      cell.count++;
      cell.sum += value;
      if (value < cell.min) cell.min = value;
      if (value > cell.max) cell.max = value;
    }
  }

  return {
    xLabels: Array.from({ length: xSize }, (_, i) => choiceLabel(x.spec!, i)),
    yLabels: y ? Array.from({ length: ySize }, (_, i) => choiceLabel(y.spec!, i)) : [''],
    cells,
  };
}

export function aggregate(cell: PivotCell, aggregation: Aggregation): number | null {
  if (aggregation === 'count') return cell.scenarios;
  if (cell.count === 0) return null;
  switch (aggregation) {
    case 'avg':
      return cell.sum / cell.count;
    case 'sum':
      return cell.sum;
    case 'min':
      return cell.min;
    case 'max':
      return cell.max;
  }
}

/** True if the cell's values are ranges (like =A1:B5), which get charted as lines. */
export function isRangeValued(run: Run, addr: string): boolean {
  return run.n > 0 && isRange(run.columns[addr]?.[0]);
}

export interface Series {
  /** Which choices this line is for, like "car=500, apartment=2,800". */
  label: string;
  /** The choices themselves: [amb cell, index of the choice]. */
  choices: [CellInfo, number][];
  points: [number, number][];
  /** Whether any scenario that draws this line satisfies the filters. */
  passing: boolean;
}

export interface LineChart {
  series: Series[];
  /** How many distinct lines there are (there may be more than are drawn). */
  total: number;
  /** The labels along the x axis when x isn't numeric (then x is an index into these). */
  categories: string[] | null;
  x: [number, number];
  y: [number, number];
}

/**
 * Lines for a range-valued cell: one per combination of the choices the cell depends on
 * (or, when it depends on a continuous distribution, one per sampled scenario). A range
 * with two columns is a list of (x, y) points; a single column or row is a list of ys.
 */
export function lineChart(run: Run, info: CellInfo, mask: Uint8Array | null, maxSeries = 150): LineChart | null {
  const column = run.columns[info.addr];
  if (!column) return null;
  const deps = info.deps.map((addr) => run.compiled.cells.get(addr)!).filter((dep) => dep?.spec);
  const discrete = deps.every((dep) => !isContinuous(dep.spec!));
  const depColumns = deps.map((dep) => run.columns[ambKey(dep.addr)]);

  const categories = new Map<string, number>();
  let categorical: boolean | null = null;
  const toPoints = (range: RangeValue): [number, number][] => {
    const rows = range.length;
    const cols = rows > 0 ? range[0].length : 0;
    const pairs: [unknown, unknown][] =
      cols >= 2 && rows > 1
        ? range.map((row) => [row[0], row[1]])
        : (rows === 1 ? range[0] : range.map((row) => row[0])).map((y, i) => [i + 1, y]);
    const points: [number, number][] = [];
    for (const [x, y] of pairs) {
      if (typeof y !== 'number') continue;
      if (categorical === null) categorical = typeof x !== 'number';
      if (!categorical) {
        if (typeof x === 'number') points.push([x, y]);
        continue;
      }
      const label = printValue(x as RawValue);
      if (!categories.has(label)) categories.set(label, categories.size);
      points.push([categories.get(label)!, y]);
    }
    return points;
  };

  const byKey = new Map<string | number, Series | null>();
  const series: Series[] = [];
  for (let i = 0; i < run.n; i++) {
    const value = column[i];
    if (!isRange(value)) continue;
    const key = discrete ? depColumns.map((choices) => choices[i]).join(',') : i;
    let s = byKey.get(key);
    if (s === undefined) {
      s = null;
      if (series.length < maxSeries) {
        const choices = discrete ? deps.map((dep, d): [CellInfo, number] => [dep, depColumns[d][i]]) : [];
        s = {
          label: choices.map(([dep, index]) => `${dep.name ?? dep.addr}=${choiceLabel(dep.spec!, index)}`).join(', '),
          choices,
          points: toPoints(value),
          passing: false,
        };
        series.push(s);
      }
      byKey.set(key, s);
    }
    if (s && (!mask || mask[i])) s.passing = true;
  }

  const x: [number, number] = [Infinity, -Infinity];
  const y: [number, number] = [Infinity, -Infinity];
  for (const s of series) {
    for (const [px, py] of s.points) {
      x[0] = Math.min(x[0], px);
      x[1] = Math.max(x[1], px);
      y[0] = Math.min(y[0], py);
      y[1] = Math.max(y[1], py);
    }
  }
  if (x[0] === Infinity) return null;

  return {
    series,
    total: byKey.size,
    categories: categorical ? [...categories.keys()] : null,
    x,
    y,
  };
}
