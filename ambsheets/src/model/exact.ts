// Counting exactly how many scenarios satisfy the filters, by checking every one.
//
// This is a second opinion for sampled results. When a sheet is being sampled but has
// few enough scenarios to enumerate (it was sampled because that was asked for, or
// because enumerating looked too slow to do on every edit), the true share of scenarios
// that match the filters can still be worked out in the background, and shown next to
// the estimate.

import { passes, type Filter, type Filters } from './analysis';
import type { CompiledSheet } from './compile';
import { EXHAUSTIVE_MAX_FORCED } from './run';

export interface ExactCount {
  /** The filters that were counted. */
  filters: Filters;
  /** How many scenarios there are, how many have been checked, and how many of those match. */
  cardinality: number;
  checked: number;
  matching: number;
  done: boolean;
}

/** True if every scenario of the sheet can be visited. */
export const canCountExactly = (compiled: CompiledSheet) =>
  compiled.engine !== null && !compiled.continuous && compiled.cardinality <= EXHAUSTIVE_MAX_FORCED;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A count in progress: call advance() until it is done. */
export class ExactEvaluation {
  readonly count: ExactCount;
  private readonly sampler: Iterator<Record<string, any>> | null = null;
  private readonly checks: [string, Filter][];

  constructor(compiled: CompiledSheet, filters: Filters) {
    this.checks = [...filters].filter(([id]) => compiled.subjectsById.has(id));
    // a filter on a cell with a single value passes in every scenario or in none
    const impossible = [...filters].some(([id, filter]) => {
      const cell = compiled.cells.get(id);
      return cell?.kind === 'const' && !passes(filter, cell.value);
    });
    const countable = canCountExactly(compiled) && !impossible;
    this.count = {
      filters,
      cardinality: compiled.cardinality,
      checked: countable ? 0 : compiled.cardinality,
      matching: 0,
      done: !countable,
    };
    if (countable) this.sampler = compiled.engine!.sampler({ preferExhaustive: true });
  }

  advance(budgetMs = Infinity): void {
    const { count, sampler, checks } = this;
    if (count.done || !sampler) return;
    const start = now();
    while (!count.done) {
      for (let i = 0; i < 64; i++) {
        const { done, value: scenario } = sampler.next();
        if (done) {
          count.done = true;
          break;
        }
        count.checked++;
        if (checks.every(([id, filter]) => passes(filter, scenario[id]))) count.matching++;
      }
      if (now() - start >= budgetMs) break;
    }
  }
}

/** Counts in one go. (The UI uses an ExactCounter instead, to stay responsive.) */
export function countExactly(compiled: CompiledSheet, filters: Filters): ExactCount {
  const evaluation = new ExactEvaluation(compiled, filters);
  evaluation.advance();
  return evaluation.count;
}

const SLICE_MS = 8;
const PUBLISH_EVERY_MS = 200;

/** Runs an ExactEvaluation in slices, publishing progress to `onUpdate`. */
export class ExactCounter {
  private evaluation: ExactEvaluation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished = 0;

  constructor(private readonly onUpdate: (count: ExactCount) => void) {}

  start(compiled: CompiledSheet, filters: Filters): void {
    this.stop();
    this.evaluation = new ExactEvaluation(compiled, filters);
    this.lastPublished = now();
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
    const { count } = evaluation;
    if (count.done || now() - this.lastPublished >= PUBLISH_EVERY_MS) {
      this.lastPublished = now();
      this.onUpdate({ ...count });
    }
    if (!count.done) this.timer = setTimeout(this.step, 4);
  };
}
