import * as d3 from 'd3-random';
import { ConditionedSampler, type ConditionedConfig } from './conditioned-sampler';

export { ConditionedSampler };
export type { ConditionedConfig, ConditionedStatus } from './conditioned-sampler';

export abstract class Amb<T> {
  constructor(protected readonly random: () => number) {}

  // support for Monte Carlo sampling
  abstract next(): T;

  // support for conditioned sampling (MCMC)

  /** True for ambs whose values are numbers on a continuum, which can be nudged together. */
  readonly continuous: boolean = false;

  /**
   * A random move away from `current`. `step` (between 0 and 1) says how far to go: a
   * small step lands near `current`, and a step of 1 is a fresh draw.
   *
   * The one requirement is that moves be *reversible* with respect to this amb's own
   * distribution: if x is drawn from the amb, moving from x to y has to be exactly as
   * likely as drawing y and moving to x. That makes any sequence of moves leave the
   * amb's distribution unchanged, which is what lets a sampler wander through scenarios
   * without having to correct for where it has been.
   *
   * A fresh draw always qualifies, so that is the default.
   */
  move(_current: T, _step: number): T {
    return this.next();
  }
}

export abstract class FiniteAmb<T> extends Amb<T> {
  // support for exhaustive enumeration
  abstract rewind(): void;
  abstract nextExhaustive(): T | undefined;
}

class OneOf<T> extends FiniteAmb<T> {
  constructor(random: () => number, private readonly values: T[]) {
    super(random);
    if (this.values.length === 0) {
      throw new Error('OneOf constructor needs at least one value');
    }
  }

  next() {
    const idx = Math.floor(this.random() * this.values.length);
    return this.values[idx];
  }

  // support for exhaustive enumeration

  private nextIdx = 0;

  rewind() {
    this.nextIdx = 0;
  }

  nextExhaustive(): T | undefined {
    return this.nextIdx < this.values.length ? this.values[this.nextIdx++] : undefined;
  }

  // support for conditioned sampling

  /** Where each value is in the list. Null if a value occurs more than once. */
  private indexes: Map<T, number> | null | undefined;

  move(current: T, step: number): T {
    const n = this.values.length;
    if (this.indexes === undefined) {
      const indexes = new Map(this.values.map((value, idx) => [value, idx]));
      this.indexes = indexes.size === n ? indexes : null;
    }
    const idx = this.indexes?.get(current);
    if (step >= 1 || n < 3 || idx === undefined) {
      return this.next();
    }
    // A hop to a nearby value in the list (wrapping around at the ends, so that every
    // hop is as likely as the hop back).
    const radius = Math.max(1, Math.round((step * n) / 2));
    const hop = 1 + Math.floor(this.random() * radius);
    return this.values[(idx + (this.random() < 0.5 ? hop : n - (hop % n))) % n];
  }
}

class PermutationOf<T> extends FiniteAmb<T[]> {
  constructor(random: () => number, private readonly values: T[]) {
    super(random);
  }

  next() {
    const acc: T[] = [];
    const xs = this.values.slice();
    while (xs.length > 0) {
      const idx = Math.floor(this.random() * xs.length);
      acc.push(xs[idx]);
      xs.splice(idx, 1);
    }
    return acc;
  }

  // support for exhaustive enumeration

  private iterator: Iterator<T[]> | null = null;

  nextExhaustive(): T[] | undefined {
    if (this.iterator == null) {
      this.rewind();
    }
    const { value, done } = this.iterator!.next();
    return !done ? value : undefined;
  }

  // support for conditioned sampling

  move(current: T[], step: number): T[] {
    const n = current.length;
    if (step >= 1 || n < 2) {
      return this.next();
    }
    // swap two elements
    const i = Math.floor(this.random() * n);
    let j = Math.floor(this.random() * (n - 1));
    if (j >= i) {
      j++;
    }
    const moved = current.slice();
    [moved[i], moved[j]] = [moved[j], moved[i]];
    return moved;
  }

  rewind() {
    const values = this.values;
    this.iterator = (function* () {
      yield* permute(values, []);
    })();

    function* permute(xs: T[], acc: T[]): Generator<T[]> {
      if (xs.length === 0) {
        yield acc;
      } else {
        for (let idx = 0; idx < xs.length; idx++) {
          const x = xs[idx];
          const remainingXs = xs.slice();
          remainingXs.splice(idx, 1);
          yield* permute(remainingXs, [...acc, x]);
        }
      }
    }
  }
}

abstract class Distribution<T> extends Amb<T> {
  readonly continuous = true;

  constructor(random: () => number, private readonly _next: () => T) {
    super(random);
  }

  next() {
    return this._next();
  }
}

class Uniform extends Distribution<number> {
  constructor(random: () => number, private readonly min: number, private readonly max: number) {
    super(random, d3.randomUniform.source(random)(min, max));
  }

  move(current: number, step: number): number {
    const { min, max } = this;
    if (step >= 1 || !(max > min)) {
      return this.next();
    }
    // a step either way, bouncing off the ends of the interval
    let x = current + (max - min) * step * (2 * this.random() - 1);
    while (x < min || x > max) {
      x = x < min ? 2 * min - x : 2 * max - x;
    }
    return x;
  }
}

class Normal extends Distribution<number> {
  private readonly noise: () => number;

  constructor(random: () => number, private readonly mean: number, private readonly stdev: number) {
    super(random, d3.randomNormal.source(random)(mean, stdev));
    this.noise = d3.randomNormal.source(random)(0, 1);
  }

  move(current: number, step: number): number {
    if (step >= 1) {
      return this.next();
    }
    // Shrink towards the mean a little and add noise to make up for it. (This is the
    // "preconditioned Crank-Nicolson" move; it leaves a normal distribution unchanged
    // for any step size.)
    return (
      this.mean +
      Math.sqrt(1 - step * step) * (current - this.mean) +
      step * this.stdev * this.noise()
    );
  }
}

class AmbFactory {
  constructor(private readonly random: () => number) {}

  value<T>(x: T) {
    return new OneOf(this.random, [x]);
  }

  oneOf<T>(xs: T[]) {
    return new OneOf(this.random, xs);
  }

  range(from: number, to: number, by = 1) {
    const values: number[] = [];
    for (let n = from; n <= to; n += by) {
      values.push(n);
    }
    return new OneOf(this.random, values);
  }

  permutationOf<T>(xs: T[]) {
    return new PermutationOf(this.random, xs);
  }

  uniform(min: number, max: number) {
    return new Uniform(this.random, min, max);
  }

  normal(mean: number, stdev: number) {
    return new Normal(this.random, mean, stdev);
  }
}

type Ambs<ATs> = { [name in keyof ATs]: Amb<ATs[name]> };
type Scenario<ATs, FTs> = {} & ATs & FTs;
type Formulas<ATs, FTs> = { [name in keyof FTs]: (scenario: Scenario<ATs, FTs>) => FTs[name] };
type AnalysisResults<ATs, FTs> = Partial<{
  [Property in keyof ATs | keyof FTs]: {
    histogram?: Map<any, number>;
    stats?: NumberStats;
  };
}>;

const MAX_DISTICT_VALUES = 25;

export interface NumberStats {
  avg: number;
  min: number;
  max: number;
}

class Analysis<ATs, FTs> {
  private readonly data = new Map<keyof ATs | keyof FTs, AnalysisData>();

  process(scenario: Scenario<ATs, FTs>) {
    for (const [key, value] of entries(scenario)) {
      let data = this.data.get(key as any); // stupid typecast!
      if (!data) {
        data = new AnalysisData();
        this.data.set(key as any, data);
      }
      data.add(value);
    }
  }

  getLatestResults(): AnalysisResults<ATs, FTs> {
    const results: AnalysisResults<ATs, FTs> = {};
    for (const [key, { valueCounts, numberStats }] of this.data.entries()) {
      const output: {
        histogram?: Map<any, number>;
        stats?: NumberStats;
      } = {};
      if (valueCounts) {
        output.histogram = valueCounts;
      }
      if (numberStats) {
        output.stats = numberStats;
      }
      if (valueCounts || numberStats) {
        results[key] = output;
      }
    }
    return results;
  }
}

class AnalysisData {
  // for all types
  private _valueCounts: Map<any, number> | null = new Map<any, number>();
  private isAllNumbers = true;

  // only for all-number cells
  private min?: number;
  private max?: number;
  private total = 0;
  private count = 0;

  add(value: any) {
    this.updateCounts(value);
    this.updateNumberFields(value);
  }

  get valueCounts() {
    return this._valueCounts;
  }

  private updateCounts(value: any) {
    if (!this._valueCounts) {
      return;
    }

    const count = (this._valueCounts.get(value) ?? 0) + 1;
    this._valueCounts.set(value, count);

    if (this._valueCounts.size > MAX_DISTICT_VALUES) {
      this._valueCounts = null;
    }
  }

  get numberStats(): NumberStats | null {
    return this.isAllNumbers
      ? { min: this.min!, max: this.max!, avg: this.total / this.count }
      : null;
  }

  private updateNumberFields(value: any) {
    if (!this.isAllNumbers) {
      return;
    }

    if (typeof value === 'number') {
      this.min = this.min === undefined ? value : Math.min(this.min, value);
      this.max = this.max === undefined ? value : Math.max(this.max, value);
      this.total += value;
      this.count++;
    } else {
      this.isAllNumbers = false;
    }
  }
}

class Sampler<ATs, FTs> implements Iterator<Scenario<ATs, FTs>> {
  private readonly scenarios: Scenario<ATs, FTs>[] = [];
  private readonly filteredAnalyses: {
    filterSet: (keyof ATs | keyof FTs)[];
    analysis: Analysis<ATs, FTs>;
  }[] = [];

  constructor(
    private readonly generator: Iterator<Scenario<ATs, FTs>>,
    filterSets: (keyof ATs | keyof FTs)[][]
  ) {
    this.addAnalysis([]);
    for (const fs of filterSets) {
      this.addAnalysis(fs);
    }
  }

  private addAnalysis(filterSet: (keyof ATs | keyof FTs)[]): Analysis<ATs, FTs> {
    let analysis: Analysis<ATs, FTs> | null = this.getAnalysis(filterSet);
    if (!analysis) {
      analysis = new Analysis<ATs, FTs>();
      this.filteredAnalyses.push({ filterSet, analysis });
      for (const scenario of this.scenarios) {
        analysis.process(scenario);
      }
    }
    return analysis;
  }

  private getAnalysis(filterSet: (keyof ATs | keyof FTs)[]): Analysis<ATs, FTs> | null {
    for (const { filterSet: fs, analysis } of this.filteredAnalyses) {
      if (fs.length === filterSet.length && fs.every((_, idx) => fs[idx] === filterSet[idx])) {
        return analysis;
      }
    }
    return null;
  }

  private getOrAddAnalysis(filterSet: (keyof ATs | keyof FTs)[]): Analysis<ATs, FTs> {
    return this.getAnalysis(filterSet) ?? this.addAnalysis(filterSet);
  }

  next() {
    const result = this.generator.next();
    const scenario = result.value as Scenario<ATs, FTs>;
    if (scenario) {
      this.process(scenario);
    }
    return result;
  }

  private satisfies(scenario: Scenario<ATs, FTs>, filterSet: (keyof ATs | keyof FTs)[]) {
    return filterSet.every((key) => scenario[key]);
  }

  private process(scenario: Scenario<ATs, FTs>) {
    for (const { filterSet, analysis } of this.filteredAnalyses) {
      if (this.satisfies(scenario, filterSet)) {
        analysis.process(scenario);
      }
    }
  }

  [Symbol.iterator]() {
    return this;
  }

  getLatestAnalysisResults(filterSet: (keyof ATs | keyof FTs)[] = []) {
    const analysis = this.getOrAddAnalysis(filterSet);
    return analysis.getLatestResults();
  }
}

export class AmbEngine<ATs = any, FTs = any> {
  constructor(
    private readonly makeAmbDict: (factory: AmbFactory) => Ambs<ATs>,
    private readonly formulaDict: Formulas<ATs, FTs>
  ) {}

  sampler(config?: {
    filterSets?: (keyof ATs | keyof FTs)[][];
    preferExhaustive?: boolean;
    randomSeed?: number;
  }) {
    const filterSets = config?.filterSets ?? [];
    const preferExhaustive = config?.preferExhaustive ?? true;
    const randomSeed = config?.randomSeed ?? Math.random();
    const random = d3.randomLcg(randomSeed);
    const factory = new AmbFactory(random);
    const ambDict = this.makeAmbDict(factory);
    return preferExhaustive && Object.values(ambDict).every((amb) => amb instanceof FiniteAmb)
      ? this.exhaustiveSampler(ambDict, filterSets)
      : this.monteCarloSampler(ambDict, filterSets);
  }

  /**
   * A sampler for scenarios that satisfy conditions, which keeps working when hardly any
   * scenario does. See conditioned-sampler.ts.
   */
  conditionedSampler(
    config: ConditionedConfig<Scenario<ATs, FTs>>
  ): ConditionedSampler<Scenario<ATs, FTs>> {
    const random = d3.randomLcg(config.randomSeed ?? Math.random());
    const ambDict = this.makeAmbDict(new AmbFactory(random));
    const { lazy, complete } = this.scenarioFns(ambDict);
    return new ConditionedSampler(
      entries(ambDict) as [string, Amb<any>][],
      random,
      lazy as (ambValues: Record<string, any>) => Scenario<ATs, FTs>,
      complete as (ambValues: Record<string, any>) => Scenario<ATs, FTs>,
      config
    );
  }

  private monteCarloSampler(
    ambDict: Ambs<ATs>,
    filterSets: (keyof ATs | keyof FTs)[][]
  ): Sampler<ATs, FTs> {
    const computeFormulas = this.computeFormulasFn(ambDict);
    const ambs = entries(ambDict);

    function* genScenarios() {
      while (true) {
        const scenario: Partial<Scenario<ATs, FTs>> = {};
        for (const [name, amb] of ambs) {
          scenario[name] = amb.next() as Scenario<ATs, FTs>[typeof name]; // TODO: why do I need this typecast?
        }
        yield computeFormulas(scenario);
      }
    }

    return new Sampler(genScenarios(), filterSets);
  }

  // TODO: randomize the order
  private exhaustiveSampler(
    ambDict: Ambs<ATs>,
    filterSets: (keyof ATs | keyof FTs)[][]
  ): Sampler<ATs, FTs> {
    const computeFormulas = this.computeFormulasFn(ambDict);
    const ambs = [...entries(ambDict)];

    function* genScenarios(ambIdx: number, s: Partial<ATs>): Generator<Scenario<ATs, FTs>> {
      if (ambIdx === ambs.length) {
        const scenario = computeFormulas(s as Partial<Scenario<ATs, FTs>>);
        yield scenario;
      } else {
        const [name, _amb] = ambs[ambIdx];
        const amb = _amb as FiniteAmb<any>;
        while (true) {
          const value = amb.nextExhaustive();
          if (value === undefined) {
            amb.rewind();
            break;
          }
          yield* genScenarios(ambIdx + 1, { ...s, [name]: value });
        }
      }
    }

    return new Sampler(genScenarios(0, {}), filterSets);
  }

  private computeFormulasFn(
    ambDict: Ambs<ATs>
  ): (scenario: Partial<Scenario<ATs, FTs>>) => Scenario<ATs, FTs> {
    return this.scenarioFns(ambDict).complete;
  }

  /**
   * Two ways to turn amb values into a scenario:
   *
   *   - `lazy` wraps them in an object that computes each formula when it is first read
   *     (and remembers it). Whoever only needs a few cells only pays for those cells
   *     and the ones they depend on.
   *   - `complete` computes every formula, and returns a plain object with the amb
   *     values and the formula values.
   *
   * Both store what they compute in the object they are given.
   */
  private scenarioFns(ambDict: Ambs<ATs>): {
    lazy: (values: Partial<Scenario<ATs, FTs>>) => Scenario<ATs, FTs>;
    complete: (values: Partial<Scenario<ATs, FTs>>) => Scenario<ATs, FTs>;
  } {
    // The getters live on a prototype that is set up once, rather than on every scenario.
    const proto = {};
    for (const [name, _] of entries(ambDict)) {
      Object.defineProperty(proto, name, {
        get(this: LazyScenario) {
          return this[VALUES][name];
        },
        enumerable: true,
      });
    }
    const formulas = entries(this.formulaDict);
    for (const [name, formula] of formulas) {
      Object.defineProperty(proto, name, {
        get(this: LazyScenario) {
          const values = this[VALUES];
          if (!(name in values)) {
            values[name] = formula(this as any);
          }
          return values[name];
        },
        enumerable: true,
      });
    }

    const lazy = (values: Partial<Scenario<ATs, FTs>>) => {
      const scenario: LazyScenario = Object.create(proto);
      scenario[VALUES] = values;
      return scenario as any as Scenario<ATs, FTs>;
    };

    const complete = (values: Partial<Scenario<ATs, FTs>>) => {
      const scenario: any = lazy(values);
      for (const [name, _] of formulas) {
        scenario[name]; // call getter, for effect!
      }
      return values as Scenario<ATs, FTs>;
    };

    return { lazy, complete };
  }
}

const VALUES = Symbol('values');

interface LazyScenario {
  [VALUES]: any;
}

// helpers

// needed b/c Object.entries is not usefully typed
function entries<T extends { [k: string]: any }>(obj: T): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(obj) as any;
}
