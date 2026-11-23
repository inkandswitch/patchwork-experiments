// Runs a compiled sheet through amb-engine, and decides how.
//
// There are two ways to evaluate a model. *Exhaustive* evaluation visits every scenario,
// so its results are exact, but it is only possible when every amb is discrete and only
// practical when there aren't too many scenarios. *Monte Carlo* evaluation draws
// scenarios at random; it works for any model, and its results sharpen as it goes.
//
// In "auto" mode Ambsheets picks for you, from the cardinality of the model (how many
// scenarios exist) and how long one scenario takes to evaluate (which it measures).
//
// Either way the work happens in short slices, and after every slice or so the run is
// published to the UI, so results show up while the evaluation is still going. That is
// most visible with Monte Carlo: values, counts and averages keep moving as samples
// arrive. amb-engine supports this directly: its sampler is an iterator that is pulled
// one scenario at a time, and it keeps a running analysis (per cell: a histogram of the
// distinct values seen so far, and min/max/avg) that can be read at any moment.

import type { NumberStats } from '../engine/amb-engine';
import { printCount } from '../lang/values';
import type { CompiledSheet } from './compile';

export type EvalMode = 'auto' | 'exhaustive' | 'montecarlo';

export interface EvalSettings {
  mode: EvalMode;
  /** How many scenarios a Monte Carlo evaluation draws (before being asked for more). */
  samples: number;
  seed: number;
}

export const DEFAULT_SETTINGS: EvalSettings = { mode: 'auto', samples: 100_000, seed: 0.5 };
export const SAMPLE_SIZES = [1_000, 10_000, 100_000, 500_000];

/** Auto mode enumerates when that is expected to take no longer than this... */
export const EXHAUSTIVE_TIME_BUDGET_MS = 3_000;
/** ...and involves no more scenarios than this (they are all kept in memory). */
export const EXHAUSTIVE_MAX_AUTO = 250_000;
/** Asking for exhaustive evaluation explicitly raises the ceiling, but there still is one. */
export const EXHAUSTIVE_MAX_FORCED = 2_000_000;

/** What amb-engine's running analysis knows about one cell. */
export interface CellAnalysis {
  /** Distinct values and how many scenarios had each; absent once there are too many. */
  histogram?: Map<any, number>;
  /** Present when every value so far has been a number. */
  stats?: NumberStats;
}

export interface Run {
  compiled: CompiledSheet;
  /** How the model is actually being evaluated... */
  mode: 'exhaustive' | 'montecarlo';
  /** ...what was asked for... */
  requested: EvalMode;
  /** ...and why it came out that way, in words. */
  reason: string;
  /** Scenarios evaluated so far. */
  n: number;
  /** Scenarios this run will stop at: all of them (exhaustive) or the sample size. */
  target: number;
  done: boolean;
  /**
   * The scenarios themselves, by column (see CompiledSheet.columns). Values are stored
   * under the id of their subject: a varying cell's address, or the id of an amb inside a
   * formula. Each amb's raw choice (an index, or the number drawn) is under its key.
   * Only the first `n` entries of each column are meaningful.
   */
  columns: Record<string, any[]>;
  /** amb-engine's analysis of all scenarios so far, by subject id. */
  analysis: Record<string, CellAnalysis>;
  /** Measured cost of one scenario, in milliseconds (0 until known). */
  msPerScenario: number;
}

export interface ModeChoice {
  mode: 'exhaustive' | 'montecarlo';
  reason: string;
}

/**
 * Decides between exhaustive and Monte Carlo evaluation. `msPerScenario` is only
 * consulted in auto mode, and may be a thunk so it is only measured when it matters.
 */
export function chooseMode(
  compiled: Pick<CompiledSheet, 'cardinality' | 'continuous'>,
  settings: EvalSettings,
  msPerScenario: number | (() => number),
): ModeChoice {
  const { cardinality, continuous } = compiled;
  const count = printCount(cardinality);
  const scenarios = cardinality === 1 ? 'scenario' : 'scenarios';

  if (continuous) {
    return {
      mode: 'montecarlo',
      reason:
        'This model has continuous distributions, so it has infinitely many scenarios. They can only be sampled.',
    };
  }

  if (settings.mode === 'montecarlo') {
    return {
      mode: 'montecarlo',
      reason: `Sampling at random from ${count} ${scenarios}, as requested.`,
    };
  }

  if (settings.mode === 'exhaustive') {
    return cardinality <= EXHAUSTIVE_MAX_FORCED
      ? { mode: 'exhaustive', reason: `Checking all ${count} ${scenarios}, as requested.` }
      : {
          mode: 'montecarlo',
          reason: `There are ${count} scenarios, which is too many to check one by one (the limit is ${printCount(EXHAUSTIVE_MAX_FORCED)}). Sampling instead.`,
        };
  }

  if (cardinality <= settings.samples) {
    return {
      mode: 'exhaustive',
      reason:
        cardinality === 1
          ? 'There is only one scenario.'
          : `There are only ${count} scenarios, so all of them are checked.`,
    };
  }

  if (cardinality > EXHAUSTIVE_MAX_AUTO) {
    return {
      mode: 'montecarlo',
      reason: `There are ${count} scenarios, which is too many to check one by one. Sampling instead.`,
    };
  }

  const ms = typeof msPerScenario === 'function' ? msPerScenario() : msPerScenario;
  const estimate = cardinality * ms;
  return estimate <= EXHAUSTIVE_TIME_BUDGET_MS
    ? {
        mode: 'exhaustive',
        reason: `There are ${count} scenarios, few enough to check all of them (about ${printDuration(estimate)}).`,
      }
    : {
        mode: 'montecarlo',
        reason: `There are ${count} scenarios. Checking all of them would take about ${printDuration(estimate)}, so they are sampled instead.`,
      };
}

function printDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Times a few scenarios to estimate what one costs. */
function measure(compiled: CompiledSheet, seed: number): number {
  const sampler = compiled.engine!.sampler({ preferExhaustive: false, randomSeed: seed });
  // warm up, so the estimate isn't dominated by code that hasn't been optimized yet
  for (let i = 0; i < 50; i++) sampler.next();
  const start = now();
  let count = 0;
  let elapsed = 0;
  while (count < 2_000 && elapsed < 8) {
    for (let i = 0; i < 25; i++) sampler.next();
    count += 25;
    elapsed = now() - start;
  }
  return Math.max(elapsed / count, 1e-4);
}

/** An evaluation in progress: call advance() until the run is done. */
export class Evaluation {
  readonly run: Run;
  private sampler: ReturnType<NonNullable<CompiledSheet['engine']>['sampler']> | null = null;
  private readonly keys: string[] = [];

  constructor(compiled: CompiledSheet, settings: EvalSettings) {
    const base = { compiled, requested: settings.mode, columns: {}, analysis: {}, msPerScenario: 0 };

    if (!compiled.engine) {
      // Nothing varies: there is one scenario, and compiling the sheet already evaluated it.
      const reason =
        compiled.cells.size === 0 ? 'The sheet is empty.' : 'There is only one scenario: no cell is an amb.';
      this.run = { ...base, mode: 'exhaustive', reason, n: 1, target: 1, done: true };
      return;
    }

    let msPerScenario = 0;
    const choice = chooseMode(compiled, settings, () => (msPerScenario = measure(compiled, settings.seed)));
    this.sampler = compiled.engine.sampler({
      preferExhaustive: choice.mode === 'exhaustive',
      randomSeed: settings.seed,
    });

    this.keys.push(...compiled.columns);
    const columns: Record<string, any[]> = {};
    for (const key of this.keys) columns[key] = [];

    this.run = {
      ...base,
      ...choice,
      columns,
      msPerScenario,
      n: 0,
      target: choice.mode === 'exhaustive' ? compiled.cardinality : settings.samples,
      done: false,
    };
  }

  /** Evaluates scenarios until the run is done or `budgetMs` has passed. */
  advance(budgetMs = Infinity): void {
    const { run, sampler, keys } = this;
    if (run.done || !sampler) return;
    const { columns } = run;
    const start = now();

    outer: while (run.n < run.target) {
      // check the clock only every so often; it is slow compared to a scenario
      for (let i = 0; i < 64 && run.n < run.target; i++) {
        const { done, value: scenario } = sampler.next();
        if (done) {
          run.target = run.n;
          break outer;
        }
        for (const key of keys) columns[key].push(scenario[key]);
        run.n++;
      }
      if (now() - start >= budgetMs) break;
    }

    run.done = run.n >= run.target;
    run.analysis = sampler.getLatestAnalysisResults() as Record<string, CellAnalysis>;
  }

  /** Monte Carlo only: asks for `count` more samples from a run that had finished. */
  extend(count: number): void {
    if (this.run.mode !== 'montecarlo' || !this.sampler) return;
    this.run.target += count;
    this.run.done = false;
  }
}

/** Evaluates a sheet in one go. (The UI uses a Runner instead, to stay responsive.) */
export function evaluate(compiled: CompiledSheet, settings: EvalSettings = DEFAULT_SETTINGS): Run {
  const evaluation = new Evaluation(compiled, settings);
  evaluation.advance();
  return evaluation.run;
}

const SLICE_MS = 10;
/** How often results are published while enumerating... */
const PUBLISH_EVERY_MS = 100;
/** ...and while sampling, where watching the estimates settle is the point. */
const PUBLISH_SAMPLES_EVERY_MS = 40;

/**
 * Evaluates sheets in the background of the UI thread: a slice of work, then a breath
 * for the browser (so it can paint, and respond to input), with the run published to
 * `onUpdate` many times a second, as a fresh object each time so that observers can tell
 * it changed. During a Monte Carlo evaluation this is what makes values, counts and
 * averages visibly update as more scenarios are sampled.
 */
export class Runner {
  private evaluation: Evaluation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished = 0;

  constructor(private readonly onUpdate: (run: Run) => void) {}

  start(compiled: CompiledSheet, settings: EvalSettings): void {
    this.stop();
    this.evaluation = new Evaluation(compiled, settings);
    this.lastPublished = 0; // always publish the first slice of a new evaluation
    // The first slice runs right away, so small models never show an empty frame.
    this.step();
  }

  /** Draws more Monte Carlo samples, continuing the current run. */
  sampleMore(count: number): void {
    if (!this.evaluation || this.timer !== null) return;
    this.evaluation.extend(count);
    this.step();
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
    const { run } = evaluation;
    const interval = run.mode === 'montecarlo' ? PUBLISH_SAMPLES_EVERY_MS : PUBLISH_EVERY_MS;
    if (run.done || now() - this.lastPublished >= interval) {
      this.lastPublished = now();
      this.onUpdate(snapshot(run));
    }
    if (!run.done) this.timer = setTimeout(this.step, 4);
  };
}

/**
 * A copy of the run that stays consistent while the evaluation carries on: amb-engine
 * keeps adding to its histograms, so those are copied (they are small).
 */
function snapshot(run: Run): Run {
  const analysis: Record<string, CellAnalysis> = {};
  for (const { id } of run.compiled.subjects) {
    const subject = run.analysis[id];
    if (subject) analysis[id] = { stats: subject.stats, histogram: subject.histogram && new Map(subject.histogram) };
  }
  return { ...run, analysis };
}
