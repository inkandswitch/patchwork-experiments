// Turns the text of a sheet into an amb-engine model.
//
// amb-engine thinks in *scenarios*: an AmbEngine is built from a dictionary of ambs (the
// choices) and a dictionary of formulas (functions of a scenario), and its sampler hands
// back one scenario at a time, either enumerating all of them or drawing them at random.
// The mapping from a sheet is:
//
//   - every amb that is written ({500, 1200}, normal(100, 15), ...) becomes an amb of the
//     engine. An amb that is a whole cell (B3 = {500, 1200}) is named "?B3"; ambs written
//     inside a larger formula (D4 = B2 * normal(1, 0.1)) are numbered: "?D4#1". For a
//     discrete amb the amb's value is the *index* of the choice, which keeps repeated
//     values distinct; for a distribution it is the sampled number.
//   - every cell whose value varies from scenario to scenario becomes a formula named
//     after its address ("B7"). Formulas read other cells through the scenario
//     (`s.B3`), which is how amb-engine evaluates them lazily and in dependency order.
//   - everything else is a constant and is folded away right here: literals, formulas
//     that don't depend on any amb, syntax errors, and cells caught in a reference cycle.

import * as d3 from 'd3-random';
import { AmbEngine } from '../engine/amb-engine';
import { builtins } from '../lang/builtins';
import { DISTRIBUTIONS, checkArgs } from './distributions';
import {
  isAmbNode,
  parseCell,
  type AmbNode,
  type AmbPart,
  type Expr,
  type Parsed,
  type RangeNode,
  type Ref,
} from '../lang/parse';
import {
  ASError,
  MAX_COLS,
  addrOf,
  isError,
  isRange,
  posOf,
  printValue,
  valueKey,
  type BasicRawValue,
  type Pos,
  type RawValue,
} from '../lang/values';

export type Scenario = Record<string, any>;
export type CellFn = (scenario: Scenario) => RawValue;

export type AmbSpec =
  /** One of a fixed list of values: an amb literal, or ambify() over constants. */
  | { kind: 'discrete'; values: BasicRawValue[] }
  /** ambify() over cells that themselves vary: a choice of which cell to read. */
  | { kind: 'pick'; cells: string[] }
  | { kind: 'normal'; mean: number; stdev: number }
  | { kind: 'uniform'; min: number; max: number }
  /**
   * A distribution whose value is worked out from a standard draw (see distributions.ts),
   * because its parameters depend on the scenario.
   */
  | { kind: 'derived'; base: 'normal' | 'uniform'; description: string };

/** One choice: an amb, as written somewhere in the sheet. */
export interface AmbInfo {
  /** "B3" when the amb is all there is in B3; "D4#1" for the first amb inside D4's formula. */
  id: string;
  /** Its name in the engine, and so the name of its column in a run: ambKey(id). */
  key: string;
  /** The cell it is written in. */
  addr: string;
  /** True if the cell is nothing but this amb. */
  whole: boolean;
  spec: AmbSpec;
  /** How it is written, like "normal(1, 0.1)". */
  source: string;
  /** Its value in a scenario. (Which the scenario also has, under `id`.) */
  fn: CellFn;
}

/**
 * Something with several possible values that can be summarized and filtered on: a cell
 * that varies, or an amb written inside a formula.
 */
export interface Subject {
  /**
   * A cell's address, or the id of an amb inside a formula ("D4#1"). In a scenario, and
   * so in the columns of a run, this is the name its value goes by.
   */
  id: string;
  /** The cell it is (in). */
  pos: Pos;
  /** What to call it: "total (B7)", or "{1, 2, 3} in D4". */
  label: string;
  /** For ambs: what kind. */
  spec: AmbSpec | null;
  /** For true/false formulas that have one: see compileMargin. */
  margin: Margin | null;
  /** True for the ambs (the inputs), false for the formulas that depend on them. */
  isAmb: boolean;
}

export interface CellInfo {
  addr: string;
  pos: Pos;
  name: string | null;
  kind: 'const' | 'amb' | 'formula';
  /** The value of a constant cell (null for the other kinds). */
  value: RawValue;
  /** For cells that are nothing but an amb (kind 'amb'): what kind of amb. */
  spec: AmbSpec | null;
  /** The ambs written in this cell: the cell itself, or ambs inside its formula. */
  ambs: AmbInfo[];
  /** Varying cells only: the cell's value in a scenario. */
  fn: CellFn | null;
  /** The ambs (by id) this cell's value depends on, its own included, in sheet order. */
  deps: string[];
  /** The varying cells this cell reads directly. */
  refs: string[];
  /**
   * For formulas that are comparisons (or ANDs, ORs and NOTs of them): *how* true the
   * formula is in a scenario. See compileMargin.
   */
  margin: Margin | null;
}

/**
 * A second reading of a true-or-false formula: positive when it is true, negative when
 * it is false, and larger in size the further it is from flipping. B7 > C3 has margin
 * B7 - C3. (NaN when there is no telling, e.g. when text is being compared.)
 */
export type Margin = (scenario: Scenario) => number;

const COMPARISON_MARGINS: Record<string, (x: number, y: number) => number> = {
  '<': (x, y) => y - x,
  '<=': (x, y) => y - x,
  '>': (x, y) => x - y,
  '>=': (x, y) => x - y,
  '=': (x, y) => -Math.abs(x - y),
  '<>': (x, y) => Math.abs(x - y),
};

export interface CompiledSheet {
  rows: number;
  cols: number;
  /** Every non-empty cell. */
  cells: Map<string, CellInfo>;
  /** Lower-cased cell name -> address. */
  names: Map<string, string>;
  /** The ambs, in sheet order. These are the dimensions of the possibility space. */
  ambs: AmbInfo[];
  ambsById: Map<string, AmbInfo>;
  /** Everything that can be summarized and filtered on, in sheet order. */
  subjects: Subject[];
  subjectsById: Map<string, Subject>;
  /** The names of the values that make up a scenario: every amb's key, and every subject's id. */
  columns: string[];
  /** The cells whose value differs between scenarios (ambs included), in sheet order. */
  varying: CellInfo[];
  /** How many scenarios there are. Infinity if any amb is a continuous distribution. */
  cardinality: number;
  continuous: boolean;
  /** Null when nothing varies, i.e. there is exactly one scenario and no work to do. */
  engine: AmbEngine<any, any> | null;
}

export const ambKey = (id: string) => '?' + id;

export const isContinuous = (spec: AmbSpec) =>
  spec.kind === 'normal' || spec.kind === 'uniform' || spec.kind === 'derived';

export function ambSize(spec: AmbSpec): number {
  switch (spec.kind) {
    case 'discrete':
      return spec.values.length;
    case 'pick':
      return spec.cells.length;
    default:
      return Infinity;
  }
}

/**
 * The distinct options of an amb that is a choice among known things. A value that is
 * repeated (to make it more likely) is one option. `slot[i]` is the option that choice
 * index i belongs to, and `first[o]` is a choice index for option o.
 */
export function options(spec: AmbSpec): { slot: number[]; first: number[]; labels: string[] } {
  const size = ambSize(spec);
  if (spec.kind !== 'discrete') {
    const indexes = Array.from({ length: Number.isFinite(size) ? size : 0 }, (_, i) => i);
    return { slot: indexes, first: indexes, labels: indexes.map((i) => choiceLabel(spec, i)) };
  }
  const byKey = new Map<string, number>();
  const slot: number[] = [];
  const first: number[] = [];
  spec.values.forEach((value, i) => {
    const key = valueKey(value);
    if (!byKey.has(key)) {
      byKey.set(key, first.length);
      first.push(i);
    }
    slot.push(byKey.get(key)!);
  });
  return { slot, first, labels: first.map((i) => printValue(spec.values[i])) };
}

/** A label for the i-th choice of a discrete amb. */
export function choiceLabel(spec: AmbSpec, index: number): string {
  switch (spec.kind) {
    case 'discrete':
      return printValue(spec.values[index]);
    case 'pick':
      return spec.cells[index];
    default:
      return '';
  }
}

export function displayName(info: { addr: string; name: string | null }): string {
  return info.name ? `${info.name} (${info.addr})` : info.addr;
}

/** What to call a choice: its cell, or (for an amb inside a formula) its text and its cell. */
export function ambLabel(amb: AmbInfo, compiled: CompiledSheet): string {
  const cell = compiled.cells.get(amb.addr);
  const where = cell ? displayName(cell) : amb.addr;
  return amb.whole ? where : `${amb.source} in ${where}`;
}

/** A short name for a choice, for labelling its values: "car", "B3", or "normal(1, 0.1)". */
export function ambName(amb: AmbInfo, compiled: CompiledSheet): string {
  return amb.whole ? (compiled.cells.get(amb.addr)?.name ?? amb.addr) : amb.source;
}

// The original Ambsheets drew normal(mean, stdev, samples) from a generator with this
// seed, so the three-argument form produces the same values it always has.
const LEGACY_NORMAL_SEED = 0.5;
const MAX_AMB_VALUES = 100_000;
const DEAMBIFY_MAX_SCENARIOS = 10_000;
const DEAMBIFY_SEED = 0.5;

export function cellText(data: unknown, row: number, col: number): string {
  const value = (data as any)?.[row]?.[col];
  return value === null || value === undefined ? '' : String(value);
}

export function compileSheet(data: unknown): CompiledSheet {
  const table: unknown[] = Array.isArray(data) ? data : [];
  const rows = table.length;
  let cols = 0;
  for (const row of table) {
    if (Array.isArray(row)) cols = Math.max(cols, row.length);
  }
  cols = Math.min(cols, MAX_COLS);

  // 1. Parse every cell, and note the names that formulas declare.
  const parsed = new Map<string, Parsed>();
  const names = new Map<string, string>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p = parseCell(cellText(table, row, col));
      if (p.kind === 'empty') continue;
      const addr = addrOf({ row, col });
      parsed.set(addr, p);
      if (p.kind === 'formula' && p.name) names.set(p.name.toLowerCase(), addr);
    }
  }

  const resolveRef = (ref: Ref): string | ASError => {
    if (ref.type === 'refError') {
      return new ASError('#REF!', 'the cell this referred to was deleted');
    }
    if (ref.type === 'nameRef') {
      return (
        names.get(ref.name.toLowerCase()) ??
        new ASError('#REF!', 'undeclared cell name ' + ref.name)
      );
    }
    return 0 <= ref.row && ref.row < rows && 0 <= ref.col && ref.col < cols
      ? addrOf(ref)
      : new ASError('#REF!', 'reference does not exist');
  };

  /** The addresses a range covers (row-major), and how many columns wide it is. */
  const rangeCells = (range: RangeNode): { addrs: string[]; numCols: number } | ASError => {
    const a = resolveRef(range.topLeft);
    if (isError(a)) return a;
    const b = resolveRef(range.bottomRight);
    if (isError(b)) return b;
    const [p, q] = [posOf(a), posOf(b)];
    const [top, bottom] = [Math.min(p.row, q.row), Math.max(p.row, q.row)];
    const [left, right] = [Math.min(p.col, q.col), Math.max(p.col, q.col)];
    const addrs: string[] = [];
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) addrs.push(addrOf({ row, col }));
    }
    return { addrs, numCols: right - left + 1 };
  };

  // 2. Find the cells that are part of a reference cycle; they become #CYCLE! errors.
  const cyclic = findCycles(parsed, (p) => staticRefs(p, resolveRef, rangeCells));

  // 3. Resolve each cell (depth first, so a cell's references are resolved before it is).
  const infos = new Map<string, CellInfo | null>();

  const resolve = (addr: string): CellInfo | null => {
    if (infos.has(addr)) return infos.get(addr)!;
    const p = parsed.get(addr);
    let info: CellInfo | null = null;
    if (p) {
      const name = p.kind === 'formula' ? p.name : null;
      info = cyclic.has(addr)
        ? constant(addr, name, new ASError('#CYCLE!', 'this cell depends on itself'))
        : build(addr, name, p);
    }
    infos.set(addr, info);
    return info;
  };

  /** A function that reads the cell at `addr`, noting the dependency if the cell varies. */
  const reader = (addr: string | ASError, refs: Set<string>): CellFn => {
    if (isError(addr)) return () => addr;
    const info = resolve(addr);
    if (info === null) return () => null;
    if (info.kind === 'const') {
      const value = info.value;
      return () => value;
    }
    refs.add(addr);
    return (s) => s[addr];
  };

  /** What is known about the cell whose formula is being compiled. */
  interface Context {
    addr: string;
    /** The whole formula. An amb that is the whole formula is the cell's own amb. */
    top: Expr;
    /** The varying cells the formula reads. */
    refs: Set<string>;
    /** The ambs written in the formula. */
    ambs: AmbInfo[];
    /** What each node compiled to, so that no node (and no amb) is ever compiled twice. */
    compiled: Map<Expr, CellFn>;
  }

  const compileExpr = (node: Expr, ctx: Context): CellFn => {
    let fn = ctx.compiled.get(node);
    if (!fn) {
      fn = compileNode(node, ctx);
      ctx.compiled.set(node, fn);
    }
    return fn;
  };

  const compileNode = (node: Expr, ctx: Context): CellFn => {
    const { refs } = ctx;
    switch (node.type) {
      case 'const': {
        const value = node.value;
        return () => value;
      }
      case 'cellRef':
      case 'nameRef':
      case 'refError':
        return reader(resolveRef(node), refs);
      case 'range': {
        const cells = rangeCells(node);
        if (isError(cells)) return () => cells;
        const readers = cells.addrs.map((addr) => reader(addr, refs));
        const numCols = cells.numCols;
        return (s) => {
          const range: BasicRawValue[][] = [];
          for (let i = 0; i < readers.length; i++) {
            const value = readers[i](s);
            if (isError(value)) return value;
            if (i % numCols === 0) range.push([]);
            // a cell that itself holds a range contributes nothing to an enclosing range
            range[range.length - 1].push(isRange(value) ? null : value);
          }
          return range;
        };
      }
      case 'if': {
        const cond = compileExpr(node.cond, ctx);
        const thenFn = compileExpr(node.then, ctx);
        const elseFn = compileExpr(node.else, ctx);
        return (s) => {
          const c = cond(s);
          return isError(c) ? c : c ? thenFn(s) : elseFn(s);
        };
      }
      case 'call': {
        const fn = builtins[node.funcName];
        if (!fn) {
          const error = new ASError('#NAME?', 'unknown function: ' + node.funcName);
          return () => error;
        }
        const args = node.args.map((arg) => compileExpr(arg, ctx));
        return (s) => {
          const values: RawValue[] = [];
          for (const arg of args) {
            const value = arg(s);
            if (isError(value)) return value;
            values.push(value);
          }
          return fn(values);
        };
      }
      case 'deambify': {
        const values = deambify(node.ref);
        return () => values;
      }
      default:
        return compileAmb(node, ctx);
    }
  };

  /**
   * An amb, wherever it is written, becomes an amb of the engine, and its value in a
   * scenario is read from the scenario. Every amb that is written is a choice of its own:
   * =normal(0, 1) + normal(0, 1) adds two different numbers. (To use the same number
   * twice, give it a cell and refer to the cell twice.)
   */
  const compileAmb = (node: AmbNode, ctx: Context): CellFn => {
    const made = node.type === 'dist' ? distribution(node, ctx) : ambSpec(node);
    if (isError(made)) return () => made;
    const { spec, derive } = 'spec' in made ? made : { spec: made, derive: undefined };

    const whole = node === ctx.top;
    const id = whole ? ctx.addr : `${ctx.addr}#${ctx.ambs.length + 1}`;
    const key = ambKey(id);

    let fn: CellFn;
    if (derive) {
      fn = guarded((s) => derive(s[key], s));
    } else if (spec.kind === 'discrete') {
      const values = spec.values;
      fn = (s) => values[s[key]];
    } else if (spec.kind === 'pick') {
      const readers = spec.cells.map((cell) => reader(cell, ctx.refs));
      fn = guarded((s) => readers[s[key]](s));
    } else {
      fn = (s) => s[key];
    }
    ctx.ambs.push({ id, key, addr: ctx.addr, whole, spec, source: node.source.trim(), fn });

    // An amb that is the whole cell is the cell's formula. One inside a larger formula
    // gets a formula of its own in the engine, named by its id, which the cell's formula
    // reads. That gives its value a place in every scenario, to be summarized and
    // filtered on like a cell's.
    return whole ? fn : (s) => s[id];
  };

  /**
   * A probability distribution. With parameters that are fixed it is one of the engine's
   * own distributions. With parameters that vary it is derived from a standard draw: see
   * distributions.ts.
   */
  const distribution = (
    node: AmbNode & { type: 'dist' },
    ctx: Context,
  ): { spec: AmbSpec; derive?: (draw: number, s: Scenario) => RawValue } | ASError => {
    const dist = DISTRIBUTIONS[node.name];
    // normal(mean, stdev, samples) is the original Ambsheets' way of writing a normal
    // distribution: a fixed number of samples from one, treated as a discrete amb.
    const legacy = node.name === 'normal' && node.args.length === 3;
    if (node.args.length !== dist.params.length && !legacy) {
      return new ASError('#N/A', `${node.name}() takes ${dist.params.length} arguments`);
    }

    // Compile the parameters, and see whether anything in them varies.
    const argCtx: Context = { ...ctx, refs: new Set() };
    const ambsBefore = ctx.ambs.length;
    const args = node.args.map((arg) => compileExpr(arg, argCtx));
    const varying = argCtx.refs.size > 0 || ctx.ambs.length > ambsBefore;
    for (const ref of argCtx.refs) ctx.refs.add(ref);

    if (varying) {
      if (legacy) return new ASError('#VALUE!', 'normal() with a number of samples needs parameters that are fixed');
      return {
        spec: { kind: 'derived', base: dist.base, description: `${capitalize(node.name)} distribution whose parameters vary` },
        derive: (draw, s) => {
          const values = checkArgs(dist, args.map((arg) => arg(s)));
          return isError(values) ? values : dist.derive(draw, values);
        },
      };
    }

    const values = checkArgs(dist, args.slice(0, dist.params.length).map((arg) => arg({})));
    if (isError(values)) return values;
    if (legacy) {
      const samples = args[2]({});
      if (typeof samples !== 'number' || !Number.isInteger(samples) || samples < 1 || samples > MAX_AMB_VALUES) {
        return new ASError('#VALUE!', `the number of samples must be between 1 and ${MAX_AMB_VALUES}`);
      }
      const [mean, stdev] = values;
      const next = d3.randomNormal.source(d3.randomLcg(LEGACY_NORMAL_SEED))(mean, stdev);
      return { spec: { kind: 'discrete', values: Array.from({ length: samples }, next).sort((a, b) => a - b) } };
    }
    if (node.name === 'normal') return { spec: { kind: 'normal', mean: values[0], stdev: values[1] } };
    if (node.name === 'uniform') return { spec: { kind: 'uniform', min: values[0], max: values[1] } };
    // (the other distributions are always derived, from fixed parameters in this case)
    return {
      spec: { kind: 'derived', base: dist.base, description: dist.describe(values.map(printValue)) },
      derive: (draw) => dist.derive(draw, values),
    };
  };

  /** What kind of choice an amb literal or ambify() describes. (Or what is wrong with it.) */
  const ambSpec = (node: AmbNode & { type: 'amb' | 'ambify' }): AmbSpec | ASError => {
    if (node.type === 'amb') {
      const values = expandAmbParts(node.parts);
      return isError(values) ? values : { kind: 'discrete', values };
    }
    const cells = rangeCells(node.range);
    if (isError(cells)) return cells;
    // Empty cells aren't choices.
    const choices = cells.addrs.filter((cell) => resolve(cell) !== null);
    if (choices.length === 0) return new ASError('#N/A', 'ambify() needs at least one non-empty cell');
    const choiceInfos = choices.map((cell) => infos.get(cell)!);
    const error = choiceInfos.find((info) => info.kind === 'const' && isError(info.value));
    if (error) return error.value as ASError;
    if (choiceInfos.every((info) => info.kind === 'const' && !isRange(info.value))) {
      return { kind: 'discrete', values: choiceInfos.map((info) => info.value as BasicRawValue) };
    }
    return { kind: 'pick', cells: choices };
  };

  /** All of a cell's values, as a range with one row. (Or the first error among them.) */
  const deambify = (ref: Ref): RawValue => {
    const target = resolveRef(ref);
    if (isError(target)) return target;
    const info = resolve(target);
    const values = info === null ? [null] : info.kind === 'const' ? [info.value] : collectValues(info, infos);
    const flat: BasicRawValue[] = [];
    for (const value of values) {
      if (isError(value)) return value;
      if (isRange(value)) flat.push(...value.flat());
      else flat.push(value);
    }
    return [flat];
  };

  /**
   * Formulas are written once and read two ways. The ordinary reading (compileExpr) gives
   * a formula's value, which is what the sheet shows. This one gives, for a formula whose
   * value is true or false, a number that says how far it is from being the other. Nobody
   * has to write anything differently to get it; it is derived from the same expression.
   *
   * It exists for the sake of filters on true/false cells. "Keep the scenarios where
   * B7 > C3" gives a sampler nothing to go on, since a scenario either qualifies or
   * doesn't. "B7 falls short of C3 by 12" tells it which scenarios are close.
   *
   *   x <= y, x < y      y - x
   *   x >= y, x > y      x - y
   *   x = y              -|x - y|
   *   x <> y             |x - y|
   *   AND(p, q, ...)     the smallest of the parts' margins (it is as true as its weakest part)
   *   OR(p, q, ...)      the largest
   *   NOT(p)             minus p's margin
   *   a reference        the margin of the cell it refers to
   *
   * Anything else has no margin (null).
   */
  const compileMargin = (node: Expr, ctx: Context): Margin | null => {
    if (node.type === 'cellRef' || node.type === 'nameRef') {
      const addr = resolveRef(node);
      return isError(addr) ? null : (resolve(addr)?.margin ?? null);
    }
    if (node.type !== 'call') return null;

    const comparison = COMPARISON_MARGINS[node.funcName];
    if (comparison && node.args.length === 2) {
      const [left, right] = node.args.map((arg) => compileExpr(arg, ctx));
      return (s) => {
        const [x, y] = [left(s), right(s)];
        return typeof x === 'number' && typeof y === 'number' ? comparison(x, y) : NaN;
      };
    }

    /** A part of an AND/OR/NOT: its margin if it has one, or else just whether it is true. */
    const part = (arg: Expr): Margin => {
      const margin = compileMargin(arg, ctx);
      if (margin) return margin;
      const value = compileExpr(arg, ctx);
      return (s) => {
        const v = value(s);
        return v === true ? Infinity : v === false ? -Infinity : NaN;
      };
    };

    if ((node.funcName === 'and' || node.funcName === 'or') && node.args.length > 0) {
      const parts = node.args.map(part);
      const pick = node.funcName === 'and' ? Math.min : Math.max;
      return (s) => parts.map((p) => p(s)).reduce((a, b) => pick(a, b));
    }
    if (node.funcName === 'not' && node.args.length === 1) {
      const inner = part(node.args[0]);
      return (s) => -inner(s);
    }
    return null;
  };

  const build = (addr: string, name: string | null, p: Parsed): CellInfo | null => {
    if (p.kind === 'empty') return null;
    if (p.kind === 'literal') return constant(addr, name, p.value);
    if (p.kind === 'error') return constant(addr, name, p.error);

    const ctx: Context = { addr, top: p.expr, refs: new Set(), ambs: [], compiled: new Map() };
    const fn = guarded(compileExpr(p.expr, ctx));
    // A formula with no amb in it, and none upstream, has one value: work it out now.
    if (ctx.refs.size === 0 && ctx.ambs.length === 0) return constant(addr, name, fn({}));

    const deps = new Set(ctx.ambs.map((amb) => amb.id));
    for (const ref of ctx.refs) {
      for (const dep of infos.get(ref)?.deps ?? []) deps.add(dep);
    }
    const whole = isAmbNode(p.expr);
    return {
      addr,
      pos: posOf(addr),
      name,
      kind: whole ? 'amb' : 'formula',
      value: null,
      spec: whole ? ctx.ambs[0].spec : null,
      ambs: ctx.ambs,
      fn,
      deps: [...deps].sort(inSheetOrder),
      refs: [...ctx.refs],
      margin: compileMargin(p.expr, ctx),
    };
  };

  for (const addr of parsed.keys()) resolve(addr);

  // 4. Package it all up.
  const cells = new Map<string, CellInfo>();
  for (const addr of parsed.keys()) {
    const info = infos.get(addr);
    if (info) cells.set(addr, info);
  }
  const varying = [...cells.values()].filter((info) => info.kind !== 'const');
  const ambs = varying.flatMap((info) => info.ambs);
  const cardinality = ambs.reduce((n, amb) => n * ambSize(amb.spec), 1);
  const subjects = varying.flatMap((info): Subject[] => [
    {
      id: info.addr,
      pos: info.pos,
      label: displayName(info),
      spec: info.spec,
      margin: info.margin,
      isAmb: info.kind === 'amb',
    },
    ...info.ambs
      .filter((amb) => !amb.whole)
      .map((amb) => ({
        id: amb.id,
        pos: info.pos,
        label: `${amb.source} in ${displayName(info)}`,
        spec: amb.spec,
        margin: null,
        isAmb: true,
      })),
  ]);

  return {
    rows,
    cols,
    cells,
    names,
    ambs,
    ambsById: new Map(ambs.map((amb) => [amb.id, amb])),
    subjects,
    subjectsById: new Map(subjects.map((subject) => [subject.id, subject])),
    columns: [...ambs.map((amb) => amb.key), ...subjects.map((subject) => subject.id)],
    varying,
    cardinality,
    continuous: ambs.some((amb) => isContinuous(amb.spec)),
    engine: varying.length > 0 ? makeEngine(ambs, varying) : null,
  };
}

function constant(addr: string, name: string | null, value: RawValue): CellInfo {
  return {
    addr,
    pos: posOf(addr),
    name,
    kind: 'const',
    value,
    spec: null,
    ambs: [],
    fn: null,
    deps: [],
    refs: [],
    margin: null,
  };
}

/**
 * Formulas never throw: whatever goes wrong in one becomes an error value in its cell.
 * Errors are also interned, so that the same error is the same object every time. That
 * matters because amb-engine's running analysis counts distinct values by identity.
 */
function guarded(fn: CellFn): CellFn {
  return (s) => {
    let value: RawValue;
    try {
      value = fn(s);
    } catch (e) {
      value = new ASError('#ERROR!', e instanceof Error ? e.message : String(e));
    }
    return isError(value) ? intern(value) : value;
  };
}

const internedErrors = new Map<string, ASError>();

function intern(error: ASError): ASError {
  const key = error.shortMsg + '\n' + error.msg;
  let interned = internedErrors.get(key);
  if (!interned) {
    if (internedErrors.size > 1000) internedErrors.clear();
    internedErrors.set(key, (interned = error));
  }
  return interned;
}

const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Orders amb ids ("B3", "D4#2") by cell, then by position within the cell. */
function inSheetOrder(a: string, b: string) {
  const [[cellA, nthA = '0'], [cellB, nthB = '0']] = [a.split('#'), b.split('#')];
  const [p, q] = [posOf(cellA), posOf(cellB)];
  return p.row - q.row || p.col - q.col || Number(nthA) - Number(nthB);
}

/** The most copies of values a weighted amb may turn into. */
const MAX_WEIGHT_UNITS = 10_000;

/**
 * Weights are shorthand for repeats: {"a": 70%, "b": 30%} is "a" seven times and "b"
 * three times. That keeps a weighted choice an ordinary list of equally likely options,
 * which is the only kind of choice that can be enumerated exactly.
 */
function expandWeights(parts: (AmbPart & { type: 'weighted' })[]): BasicRawValue[] | ASError {
  // the smallest power of ten that makes every weight a whole number...
  let scale = 1;
  const isWhole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;
  while (scale <= 1e6 && !parts.every((part) => isWhole(part.weight * scale))) scale *= 10;
  let units = parts.map((part) => Math.round(part.weight * scale));
  // ...and then the smallest whole numbers in the same proportions
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = units.reduce(gcd, 0);
  if (divisor === 0) return new ASError('#N/A', 'the weights are all zero');
  units = units.map((u) => u / divisor);
  if (scale > 1e6 || units.reduce((a, b) => a + b, 0) > MAX_WEIGHT_UNITS) {
    return new ASError('#N/A', 'these weights are too fine-grained: use rounder numbers');
  }
  return parts.flatMap((part, i) => new Array<BasicRawValue>(units[i]).fill(part.value));
}

function expandAmbParts(parts: AmbPart[]): BasicRawValue[] | ASError {
  const weighted = parts.filter((part) => part.type === 'weighted');
  if (weighted.length > 0) {
    return weighted.length === parts.length
      ? expandWeights(weighted)
      : new ASError('#N/A', 'give every value in the amb a weight, or none of them');
  }

  const values: BasicRawValue[] = [];
  const tooMany = () => new ASError('#N/A', `an amb can have at most ${MAX_AMB_VALUES} values`);
  for (const part of parts) {
    if (part.type === 'weighted') {
      continue;
    } else if (part.type === 'repeat') {
      if (values.length + part.numRepeats > MAX_AMB_VALUES) return tooMany();
      for (let i = 0; i < part.numRepeats; i++) values.push(part.value);
    } else {
      const { from, to, step } = part;
      const sensible = (from <= to && step > 0) || (from >= to && step < 0);
      if (!sensible) continue;
      const count = Math.floor((to - from) / step + 1e-9) + 1;
      if (values.length + count > MAX_AMB_VALUES) return tooMany();
      for (let i = 0; i < count; i++) {
        // computed from the index (not by repeated addition) so 0.1 steps stay tidy
        values.push(parseFloat((from + i * step).toPrecision(12)));
      }
    }
  }
  return values.length > 0 ? values : new ASError('#N/A', 'this amb has no values');
}

type AmbFactory = Parameters<ConstructorParameters<typeof AmbEngine<any, any>>[0]>[0];

function makeAmb(factory: AmbFactory, spec: AmbSpec) {
  switch (spec.kind) {
    case 'discrete':
    case 'pick':
      return factory.oneOf(Array.from({ length: ambSize(spec) }, (_, i) => i));
    case 'normal':
      return factory.normal(spec.mean, spec.stdev);
    case 'uniform':
      return factory.uniform(spec.min, spec.max);
    case 'derived':
      return spec.base === 'normal' ? factory.normal(0, 1) : factory.uniform(0, 1);
  }
}

function makeEngine(ambs: AmbInfo[], cells: CellInfo[]): AmbEngine<any, any> {
  return new AmbEngine<any, any>(
    (factory) => Object.fromEntries(ambs.map((amb) => [amb.key, makeAmb(factory, amb.spec)])),
    Object.fromEntries([
      ...cells.map((info) => [info.addr, info.fn!]),
      // (ambs inside formulas have formulas of their own: see compileAmb)
      ...ambs.filter((amb) => !amb.whole).map((amb) => [amb.id, amb.fn]),
    ]),
  );
}

/**
 * All the values a varying cell takes, for deambify(). This runs a little model of its
 * own: just the cell, the cells it reads, and the ambs they depend on.
 */
function collectValues(target: CellInfo, infos: Map<string, CellInfo | null>): RawValue[] {
  const cone = new Map<string, CellInfo>();
  const visit = (info: CellInfo) => {
    if (cone.has(info.addr)) return;
    cone.set(info.addr, info);
    for (const ref of info.refs) visit(infos.get(ref)!);
  };
  visit(target);

  const cells = [...cone.values()];
  const ambs = cells.flatMap((info) => info.ambs);
  const cardinality = ambs.reduce((n, amb) => n * ambSize(amb.spec), 1);
  const exhaustive = cardinality <= DEAMBIFY_MAX_SCENARIOS;
  const sampler = makeEngine(ambs, cells).sampler({
    preferExhaustive: exhaustive,
    randomSeed: DEAMBIFY_SEED,
  });

  const values: RawValue[] = [];
  const limit = exhaustive ? cardinality : DEAMBIFY_MAX_SCENARIOS;
  while (values.length < limit) {
    const { done, value: scenario } = sampler.next();
    if (done) break;
    values.push(scenario[target.addr]);
  }
  return values;
}

/** The cells a cell refers to, as far as can be told without evaluating anything. */
function staticRefs(
  p: Parsed,
  resolveRef: (ref: Ref) => string | ASError,
  rangeCells: (range: RangeNode) => { addrs: string[] } | ASError,
): string[] {
  if (p.kind !== 'formula') return [];
  const refs: string[] = [];
  const addRef = (ref: Ref) => {
    const addr = resolveRef(ref);
    if (!isError(addr)) refs.push(addr);
  };
  const addRange = (range: RangeNode) => {
    const cells = rangeCells(range);
    if (!isError(cells)) refs.push(...cells.addrs);
  };
  const walk = (node: Expr) => {
    switch (node.type) {
      case 'cellRef':
      case 'nameRef':
      case 'refError':
        return addRef(node);
      case 'range':
        return addRange(node);
      case 'if':
        return [node.cond, node.then, node.else].forEach(walk);
      case 'call':
        return node.args.forEach(walk);
      case 'ambify':
        return addRange(node.range);
      case 'deambify':
        return addRef(node.ref);
      case 'dist':
        return node.args.forEach(walk);
    }
  };
  walk(p.expr);
  return refs;
}

/** The cells that lie on a reference cycle (Tarjan's strongly connected components). */
function findCycles(parsed: Map<string, Parsed>, refsOf: (p: Parsed) => string[]): Set<string> {
  const edges = new Map<string, string[]>();
  for (const [addr, p] of parsed) {
    edges.set(addr, refsOf(p).filter((ref) => parsed.has(ref)));
  }

  const cyclic = new Set<string>();
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let nextIndex = 0;

  const visit = (v: string) => {
    index.set(v, nextIndex);
    lowLink.set(v, nextIndex);
    nextIndex++;
    stack.push(v);
    onStack.add(v);

    for (const w of edges.get(v)!) {
      if (!index.has(w)) {
        visit(w);
        lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!));
      }
    }

    if (lowLink.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1 || edges.get(v)!.includes(v)) {
        for (const addr of component) cyclic.add(addr);
      }
    }
  };

  for (const addr of edges.keys()) {
    if (!index.has(addr)) visit(addr);
  }
  return cyclic;
}
