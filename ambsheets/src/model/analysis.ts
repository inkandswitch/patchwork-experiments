// Reading results out of a run: filters, per-cell summaries, histograms, pivot tables
// and line charts.
//
// Everything here looks at a *view*: the scenarios that stand for the whole possibility
// space, and the scenarios that satisfy the filters. Usually the second are just some of
// the first, picked out by a mask. But when hardly any sampled scenario satisfies the
// filters, Ambsheets goes looking for ones that do (see focus.ts), and then they are a
// sample of their own.
//
// Unfiltered summaries come straight from amb-engine's running analysis, which is kept
// up to date as scenarios are evaluated and costs nothing to read. Anything that involves
// filters is computed here, from stored scenarios.

import { isRange, printValue, valueKey, type RangeValue, type RawValue } from '../lang/values';
import {
  ambName,
  choiceLabel,
  options,
  isChoice,
  type AmbInfo,
  type AmbSpec,
  type CellInfo,
} from './compile';
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

/** Some scenarios, stored by column. Only the first `n` entries of a column count. */
export interface Sample {
  columns: Record<string, any[]>;
  n: number;
}

export interface View {
  /** The scenarios that stand for all scenarios (and amb-engine's analysis of them). */
  all: Run;
  /**
   * Where the scenarios that satisfy the filters are: `all` itself, or a separate sample
   * of scenarios that were sought out because so few of `all` qualify.
   */
  matching: Sample;
  /** Which rows of `matching` count: mask[i] is 1 if row i does. Null means all of them. */
  mask: Uint8Array | null;
}

/** True if the matching scenarios are a sample of their own. */
export const isFocused = (view: View) => view.matching !== view.all;

/** True if any filter is in effect. */
export const isFiltering = (view: View) => isFocused(view) || view.mask !== null;

/**
 * Which scenarios of a sample satisfy the filters. Null means that no filter applies,
 * i.e. every scenario passes.
 */
export function passMask(sample: Sample, filters: Filters): Uint8Array | null {
  const active = [...filters].filter(([addr]) => addr in sample.columns);
  if (active.length === 0) return null;
  const mask = new Uint8Array(sample.n).fill(1);
  for (const [addr, filter] of active) {
    const column = sample.columns[addr];
    for (let i = 0; i < sample.n; i++) {
      if (mask[i] && !passes(filter, column[i])) mask[i] = 0;
    }
  }
  return mask;
}

/** The plain view of a run: its own scenarios, filtered. */
export function viewOf(run: Run, filters: Filters = new Map()): View {
  return { all: run, matching: run, mask: passMask(run, filters) };
}

/** How many scenarios satisfy the filters (out of view.matching.n). */
export function countMatching(view: View): number {
  if (!view.mask) return view.matching.n;
  let count = 0;
  for (let i = 0; i < view.matching.n; i++) count += view.mask[i];
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
  /** How many of all the scenarios have this value... */
  count: number;
  /** ...and how many of the matching ones do. */
  passing: number;
}

export interface Summary {
  /** How many scenarios there are in all, and how many matching ones. */
  n: number;
  passing: number;
  /** The distinct values of the cell. Null when there are too many to list. */
  values: ValueCount[] | null;
  /** Present when all of the cell's values are numbers. */
  stats: Stats | null;
  /** The same, over just the scenarios that satisfy the filters. */
  passingStats: Stats | null;
}

/**
 * What to show for a varying cell, or for anything else that has a column in a run (an
 * amb inside a formula does, under its id).
 */
export function summarize(info: { addr: string; spec: AmbSpec | null }, view: View): Summary {
  const run = view.all;
  const analysis = run.analysis[info.addr];
  const n = run.n;
  const stats: Stats | null = analysis?.stats && n > 0 ? { count: n, ...analysis.stats } : null;

  let passing = n;
  let passingStats = stats;
  let passingCounts: Map<any, number> | null = null;

  if (isFiltering(view)) {
    // One pass over the matching scenarios for everything that depends on the filters.
    const { matching, mask } = view;
    const column = matching.columns[info.addr];
    passingCounts = analysis?.histogram ? new Map() : null;
    passing = 0;
    let numbers = 0;
    let [sum, min, max] = [0, Infinity, -Infinity];
    for (let i = 0; i < matching.n; i++) {
      if (mask && !mask[i]) continue;
      passing++;
      const value = column[i];
      if (passingCounts) passingCounts.set(value, (passingCounts.get(value) ?? 0) + 1);
      if (typeof value === 'number') {
        numbers++;
        sum += value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    passingStats =
      passing > 0 && numbers === passing ? { count: passing, avg: sum / passing, min, max } : null;
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
    if (passingCounts && isFocused(view)) {
      // values that only turned up among the scenarios that were sought out
      for (const [value, count] of passingCounts) {
        if (!analysis.histogram.has(value)) {
          values.push({ value, key: valueKey(value), count: 0, passing: count });
        }
      }
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
function sortValues(values: ValueCount[], info: { spec: AmbSpec | null }) {
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
  /**
   * True when the matching scenarios are a sample of their own. Then `count` and
   * `passing` aren't on the same scale, and each should be drawn relative to itself.
   */
  separate: boolean;
}

/** A histogram of the numbers in a cell (ignoring any other values it has). */
export function histogram(view: View, addr: string, numBins = 20): Histogram | null {
  const { all: run, matching, mask } = view;
  const column = run.columns[addr];
  const matchingColumn = matching.columns[addr];
  if (!column || !matchingColumn) return null;
  const separate = isFocused(view);
  const isNumber = (value: unknown): value is number =>
    typeof value === 'number' && !Number.isNaN(value);

  const all = new Accumulator();
  const passing = new Accumulator();
  for (let i = 0; i < run.n; i++) {
    const value = column[i];
    if (!isNumber(value)) continue;
    all.add(value);
    if (!separate && (!mask || mask[i])) passing.add(value);
  }
  if (separate) {
    for (let i = 0; i < matching.n; i++) {
      const value = matchingColumn[i];
      if (isNumber(value) && (!mask || mask[i])) passing.add(value);
    }
  }
  if (all.count === 0) return null;

  // (the matching scenarios may lie outside the range the others happened to cover)
  const min = Math.min(all.min, passing.min);
  const max = Math.max(all.max, passing.max);
  // Whole numbers get bins that each cover the same number of them (2-4, 5-7, ...).
  // Dividing their range evenly instead would give some bins one number more than
  // others, which shows up as gaps and spikes that aren't in the data.
  const whole = all.whole && passing.whole;
  const width = whole ? Math.ceil((max - min + 1) / numBins) : (max - min) / numBins || 1;
  const count = whole ? Math.ceil((max - min + 1) / width) : max === min ? 1 : numBins;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
    passing: 0,
  }));
  const binOf = (value: number) => bins[Math.min(bins.length - 1, Math.floor((value - min) / width))];
  for (let i = 0; i < run.n; i++) {
    const value = column[i];
    if (!isNumber(value)) continue;
    const bin = binOf(value);
    bin.count++;
    if (!separate && (!mask || mask[i])) bin.passing++;
  }
  if (separate) {
    for (let i = 0; i < matching.n; i++) {
      const value = matchingColumn[i];
      if (isNumber(value) && (!mask || mask[i])) binOf(value).passing++;
    }
  }

  return { bins, min, max, all: all.summary()!, passing: passing.summary(), separate };
}

class Accumulator {
  count = 0;
  sum = 0;
  sumOfSquares = 0;
  min = Infinity;
  max = -Infinity;
  /** True as long as every value has been a whole number. */
  whole = true;

  add(value: number) {
    if (this.whole && !Number.isInteger(value)) this.whole = false;
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
  /** Scenarios in this cell of the table, and how many matching scenarios fall in it. */
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
  /** A choice index for each column and each row, for filtering on what it stands for. */
  xChoices: number[];
  yChoices: number[];
  /** cells[y][x] */
  cells: PivotCell[][];
}

/** The ambs a cell depends on that can serve as the axes of a table. */
export function tableDimensions(run: Run, info: CellInfo): AmbInfo[] {
  return info.deps
    .map((id) => run.compiled.ambsById.get(id)!)
    .filter((amb) => amb && isChoice(amb.spec));
}

/** Breaks a cell's values down by the choices made in one or two ambs. */
export function pivot(view: View, addr: string, x: AmbInfo, y: AmbInfo | null): Pivot {
  const { all: run, matching, mask } = view;
  const separate = isFocused(view);
  // (a value that is repeated in an amb, or weighted, gets one column, not several)
  const xOptions = options(x.spec);
  const yOptions = y ? options(y.spec) : null;
  const xSize = xOptions.first.length;
  const ySize = yOptions ? yOptions.first.length : 1;
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
  const xs = run.columns[x.key];
  const ys = y ? run.columns[y.key] : null;
  for (let i = 0; i < run.n; i++) {
    const cell = cells[ys ? yOptions!.slot[ys[i]] : 0][xOptions.slot[xs[i]]];
    cell.scenarios++;
    if (!separate && (!mask || mask[i])) cell.passing++;
    const value = column[i];
    if (typeof value === 'number') {
      cell.count++;
      cell.sum += value;
      if (value < cell.min) cell.min = value;
      if (value > cell.max) cell.max = value;
    }
  }
  if (separate) {
    const mxs = matching.columns[x.key];
    const mys = y ? matching.columns[y.key] : null;
    for (let i = 0; i < matching.n; i++) {
      if (!mask || mask[i]) cells[mys ? yOptions!.slot[mys[i]] : 0][xOptions.slot[mxs[i]]].passing++;
    }
  }

  return {
    xLabels: xOptions.labels,
    yLabels: yOptions ? yOptions.labels : [''],
    xChoices: xOptions.first,
    yChoices: yOptions ? yOptions.first : [],
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
  /** The choices themselves: [amb, index of the choice]. */
  choices: [AmbInfo, number][];
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
export function lineChart(view: View, info: CellInfo, maxSeries = 150): LineChart | null {
  const { all: run, matching, mask } = view;
  if (!run.columns[info.addr]) return null;
  const separate = isFocused(view);
  const deps = info.deps.map((id) => run.compiled.ambsById.get(id)!).filter(Boolean);
  const discrete = deps.every((dep) => isChoice(dep.spec));

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

  const byKey = new Map<string, Series | null>();
  const series: Series[] = [];
  /** Adds the lines of a sample; `counts` says whether its rows can make a line "passing". */
  const add = (sample: Sample, prefix: string, counts: (i: number) => boolean) => {
    const column = sample.columns[info.addr];
    const depColumns = deps.map((dep) => sample.columns[dep.key]);
    const depOptions = deps.map((dep) => options(dep.spec));
    for (let i = 0; i < sample.n; i++) {
      const value = column[i];
      if (!isRange(value)) continue;
      // (without discrete choices to go by, every scenario is a line of its own)
      // (choices of the same value, in an amb that repeats it, draw the same line)
      const key = discrete ? depColumns.map((choices, d) => depOptions[d].slot[choices[i]]).join(',') : prefix + i;
      let s = byKey.get(key);
      if (s === undefined) {
        s = null;
        if (series.length < maxSeries) {
          const choices = discrete ? deps.map((dep, d): [AmbInfo, number] => [dep, depColumns[d][i]]) : [];
          s = {
            label: choices
              .map(([dep, index]) => `${ambName(dep, run.compiled)}=${choiceLabel(dep.spec, index)}`)
              .join(', '),
            choices,
            points: toPoints(value),
            passing: false,
          };
          series.push(s);
        }
        byKey.set(key, s);
      }
      if (s && counts(i)) s.passing = true;
    }
  };

  if (separate) {
    // the lines that were sought out go first, so that they are sure to be drawn
    add(matching, 'm', (i) => !mask || mask[i] === 1);
    add(run, 'a', () => false);
  } else {
    add(run, 'a', (i) => !mask || mask[i] === 1);
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
