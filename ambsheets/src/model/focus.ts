// Focused sampling: finding scenarios that satisfy the filters when sampling at random
// hardly ever comes across one.
//
// A filter like "B7 between 3.5 and 6.8" is turned into a *condition* for amb-engine's
// conditioned sampler: a function that says how far a scenario is from passing the
// filter. For a filter on a number that is the distance to the allowed range (or to the
// nearest allowed value). For a filter on a true/false cell it comes from the formula's
// margin (see compileMargin in compile.ts): a filter for "total <= 4200 is true" knows
// that a total of 4300 is closer than one of 6000. Filters with no notion of distance
// (on text, say) can only answer yes or no, and are met by chance or not at all.

import type { ConditionedStatus } from '../engine/amb-engine';
import type { CellInfo, CompiledSheet, Scenario } from './compile';
import { passes, type Filter, type Filters, type Sample } from './analysis';

export interface FocusSettings {
  /** How many matching scenarios to collect. */
  target: number;
  seed: number;
  /** The size of the sampler's population (see ConditionedConfig). */
  particles?: number;
}

/** The scenarios found so far, and how the search is going. */
export interface Focus extends Sample, ConditionedStatus {
  /** The filters these scenarios satisfy. */
  filters: Filters;
  target: number;
  /** True once there are enough scenarios, or the search has failed. */
  done: boolean;
}

/** Above a failing filter, but small enough to disappear next to any real distance. */
const BARELY = 1e-12;

function condition(info: CellInfo, filter: Filter): (scenario: Scenario) => number {
  const addr = info.addr;

  if (filter.kind === 'range') {
    return (s) => {
      const value = s[addr];
      if (passes(filter, value)) return 0;
      if (typeof value !== 'number') return Infinity;
      return Math.max(filter.min - value, value - filter.max, BARELY);
    };
  }

  const numbers = [...filter.keys].filter((key) => key[0] === 'n').map((key) => Number(key.slice(1)));
  const [wantsTrue, wantsFalse] = [filter.keys.has('true'), filter.keys.has('false')];
  const margin = info.margin;
  return (s) => {
    const value = s[addr];
    if (passes(filter, value)) return 0;
    let distance = Infinity;
    if (typeof value === 'number') {
      for (const n of numbers) distance = Math.min(distance, Math.abs(value - n));
    } else if (typeof value === 'boolean' && margin) {
      // how far the formula is from coming out the other way
      const m = margin(s);
      if (value ? wantsFalse : wantsTrue) distance = Math.abs(m);
    }
    return distance > 0 ? distance : distance === 0 ? BARELY : Infinity;
  };
}

/**
 * The conditions that stand for a set of filters. Null if there is nothing to look for:
 * no filter applies to a cell that varies, or one of them rules out every scenario.
 */
export function conditionsFor(
  compiled: CompiledSheet,
  filters: Filters,
): ((scenario: Scenario) => number)[] | null {
  const conditions: ((scenario: Scenario) => number)[] = [];
  for (const [addr, filter] of filters) {
    const info = compiled.cells.get(addr);
    if (!info || info.kind === 'const') {
      // a cell with a single value either passes its filter in every scenario or in none
      if (!passes(filter, info?.value ?? null)) return null;
      continue;
    }
    conditions.push(condition(info, filter));
  }
  return conditions.length > 0 ? conditions : null;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A search in progress: call advance() until the focus is done. */
export class FocusEvaluation {
  readonly focus: Focus;
  private readonly sampler: ReturnType<NonNullable<CompiledSheet['engine']>['conditionedSampler']> | null;
  private readonly keys: string[] = [];
  private readonly checks: [string, Filter][];

  constructor(compiled: CompiledSheet, filters: Filters, settings: FocusSettings) {
    const conditions = compiled.engine ? conditionsFor(compiled, filters) : null;
    this.sampler =
      conditions && compiled.engine
        ? compiled.engine.conditionedSampler({
            conditions,
            randomSeed: settings.seed,
            particles: settings.particles,
          })
        : null;
    this.checks = [...filters].filter(([addr]) => compiled.cells.get(addr)?.kind !== 'const');

    for (const amb of compiled.ambs) this.keys.push(amb.key);
    for (const info of compiled.varying) this.keys.push(info.addr);
    const columns: Record<string, any[]> = {};
    for (const key of this.keys) columns[key] = [];

    this.focus = {
      filters,
      columns,
      n: 0,
      target: settings.target,
      done: this.sampler === null,
      phase: this.sampler ? 'searching' : 'failed',
      levels: 0,
      distance: Infinity,
      probability: this.sampler ? 1 : 0,
      relativeError: 0,
      acceptance: 1,
      evaluations: 0,
      produced: 0,
    };
  }

  /** Searches and samples until the focus is done or `budgetMs` has passed. */
  advance(budgetMs = Infinity): void {
    const { focus, sampler, keys } = this;
    if (focus.done || !sampler) return;
    const start = now();

    while (focus.n < focus.target && sampler.status.phase !== 'failed') {
      for (let i = 0; i < 8; i++) sampler.advance();
      for (const scenario of sampler.drain()) {
        // The sampler works to distance zero, which is the same thing as passing the
        // filters. This makes sure of it.
        if (focus.n >= focus.target || !this.checks.every(([addr, f]) => passes(f, scenario[addr]))) {
          continue;
        }
        for (const key of keys) focus.columns[key].push(scenario[key]);
        focus.n++;
      }
      if (now() - start >= budgetMs) break;
    }

    Object.assign(focus, sampler.status);
    focus.done = focus.n >= focus.target || focus.phase === 'failed';
  }
}

/** Finds matching scenarios in one go. (The UI uses a Focuser instead, to stay responsive.) */
export function findMatching(compiled: CompiledSheet, filters: Filters, settings: FocusSettings): Focus {
  const evaluation = new FocusEvaluation(compiled, filters, settings);
  evaluation.advance();
  return evaluation.focus;
}

const SLICE_MS = 10;
const PUBLISH_EVERY_MS = 60;

/**
 * Runs a FocusEvaluation in the background of the UI thread, the way Runner runs an
 * Evaluation: in slices, publishing a fresh snapshot to `onUpdate` as it goes.
 */
export class Focuser {
  private evaluation: FocusEvaluation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished = 0;

  constructor(private readonly onUpdate: (focus: Focus) => void) {}

  start(compiled: CompiledSheet, filters: Filters, settings: FocusSettings): void {
    this.stop();
    this.evaluation = new FocusEvaluation(compiled, filters, settings);
    this.lastPublished = 0;
    this.timer = setTimeout(this.step, 0);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.evaluation = null;
  }

  private step = (): void => {
    this.timer = null;
    const evaluation = this.evaluation;
    if (!evaluation) return;
    evaluation.advance(SLICE_MS);
    const { focus } = evaluation;
    if (focus.done || now() - this.lastPublished >= PUBLISH_EVERY_MS) {
      this.lastPublished = now();
      this.onUpdate({ ...focus });
    }
    if (!focus.done) this.timer = setTimeout(this.step, 4);
  };
}
