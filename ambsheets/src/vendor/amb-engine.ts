import * as d3 from 'd3-random';

export abstract class Amb<T> {
  constructor(protected readonly random: () => number) {}

  // support for Monte Carlo sampling
  abstract next(): T;
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
  constructor(random: () => number, private readonly _next: () => T) {
    super(random);
  }

  next() {
    return this._next();
  }
}

class Uniform extends Distribution<number> {
  constructor(random: () => number, min: number, max: number) {
    super(random, d3.randomUniform.source(random)(min, max));
  }
}

class Normal extends Distribution<number> {
  constructor(random: () => number, mean: number, stdev: number) {
    super(random, d3.randomNormal.source(random)(mean, stdev));
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

  private monteCarloSampler(
    ambDict: Ambs<ATs>,
    filterSets: (keyof ATs | keyof FTs)[][]
  ): Sampler<ATs, FTs> {
    const computeFormulas = this.computeFormulasFn();
    const ambs = entries(ambDict);

    function* genScenarios() {
      while (true) {
        const scenario: Partial<Scenario<ATs, FTs>> = {};
        for (const [name, amb] of ambs) {
          scenario[name] = amb.next() as Scenario<ATs, FTs>[typeof name]; // TODO: why do I need this typecast?
        }
        yield computeFormulas(ambDict, scenario);
      }
    }

    return new Sampler(genScenarios(), filterSets);
  }

  // TODO: randomize the order
  private exhaustiveSampler(
    ambDict: Ambs<ATs>,
    filterSets: (keyof ATs | keyof FTs)[][]
  ): Sampler<ATs, FTs> {
    const computeFormulas = this.computeFormulasFn();
    const ambs = [...entries(ambDict)];

    function* genScenarios(ambIdx: number, s: Partial<ATs>): Generator<Scenario<ATs, FTs>> {
      if (ambIdx === ambs.length) {
        const scenario = computeFormulas(ambDict, s as Partial<Scenario<ATs, FTs>>);
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

  private computeFormulasFn(): (
    ambDict: Ambs<ATs>,
    scenario: Partial<Scenario<ATs, FTs>>
  ) => Scenario<ATs, FTs> {
    return (ambDict: Ambs<ATs>, scenario: Partial<Scenario<ATs, FTs>>) => {
      const wrapper: Scenario<ATs, FTs> = {} as any;

      // ambs
      for (const [name, _] of entries(ambDict)) {
        wrapper[name] = scenario[name]!;
      }

      // formulas
      for (const [name, formula] of entries(this.formulaDict)) {
        Object.defineProperty(wrapper, name, {
          get() {
            if (!(name in scenario)) {
              scenario[name] = formula(wrapper) as any;
            }
            return scenario[name]!;
          },
          enumerable: true,
        });
      }

      // evaluate the formulas
      for (const name of Object.keys(wrapper as any)) {
        (wrapper as any)[name]; // call getter, for effect!
      }

      return scenario as Scenario<ATs, FTs>;
    };
  }
}

// helpers

// needed b/c Object.entries is not usefully typed
function entries<T extends { [k: string]: any }>(obj: T): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(obj) as any;
}
