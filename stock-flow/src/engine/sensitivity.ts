import { checkOutcome, measure } from "./outcomes.ts";
import { cachedRun, scenarioSettings, withKnob } from "./scenarios.ts";
import type { Outcome, ParameterId, Settings, StockFlowModelDoc, StockFlowSensitivityDoc } from "../types.ts";

export type SensitivityFields = Pick<StockFlowSensitivityDoc, "scenario" | "parameters" | "method" | "outcomes" | "ranking">;

export type SensitivityResult = {
  /** Outcomes with every parameter at its value. */
  base: number[];
  ranges: Record<ParameterId, { min: number; max: number; value: number }>;
  /** One run per parameter and end of its range (one-at-a-time), or per sample (Latin hypercube). */
  samples: Sample[];
  /** For each scenario in the ranking, the share of samples in which it wins. */
  ranking?: { scenario: string; wins: number }[];
};

export type Sample = { parameters: Record<ParameterId, number>; outcomes: number[]; varied?: ParameterId };

type Point = { parameters: Record<ParameterId, number>; varied?: ParameterId };

export function runSensitivity(model: StockFlowModelDoc, fields: SensitivityFields): SensitivityResult {
  for (const outcome of fields.outcomes) checkOutcome(model, outcome);
  const settings = scenarioSettings(model, fields.scenario);
  const ranges = parameterRanges(model, settings, fields.parameters);
  const base = outcomes(model, settings, fields.outcomes);
  const points: Point[] = fields.method.kind === "one-at-a-time" ? oneAtATime(ranges) : latinHypercube(ranges, fields.method.samples, fields.method.seed);
  const samples = points.map(({ parameters, varied }) => ({ parameters, varied, outcomes: outcomes(model, applyAll(model, settings, parameters), fields.outcomes) }));
  return { base, ranges, samples, ...(fields.ranking ? { ranking: rank(model, fields, points) } : {}) };
}

export function parameterRanges(model: StockFlowModelDoc, settings: Settings, spec: SensitivityFields["parameters"]): SensitivityResult["ranges"] {
  return Object.fromEntries(
    Object.entries(spec).map(([id, range]) => {
      const parameter = model.parameters[id];
      if (!parameter) throw new Error(`Unknown parameter "${id}"`);
      if (!("value" in parameter)) throw new Error(`"${id}" is derived from other parameters; vary one of those`);
      const value = settings.parameters[id] ?? parameter.value;
      if ("spread" in range) return [id, { min: round(value * (1 - range.spread)), max: round(value * (1 + range.spread)), value }];
      return [id, { ...range, value }];
    }),
  );
}

function oneAtATime(ranges: SensitivityResult["ranges"]): Point[] {
  return Object.entries(ranges).flatMap(([id, range]) => [
    { parameters: { [id]: range.min }, varied: id },
    { parameters: { [id]: range.max }, varied: id },
  ]);
}

/** Each parameter's range cut into `samples` strata, one draw per stratum, strata shuffled independently per parameter. */
export function latinHypercube(ranges: SensitivityResult["ranges"], samples: number, seed: number): Point[] {
  const random = mulberry32(seed);
  const columns = Object.entries(ranges).map(([id, range]) => {
    const strata = Array.from({ length: samples }, (_, index) => index);
    for (let i = strata.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [strata[i], strata[j]] = [strata[j], strata[i]];
    }
    return strata.map((stratum) => [id, range.min + ((stratum + random()) / samples) * (range.max - range.min)] as const);
  });
  return Array.from({ length: samples }, (_, index) => ({ parameters: Object.fromEntries(columns.map((column) => column[index])) }));
}

function rank(model: StockFlowModelDoc, fields: SensitivityFields, points: Point[]): { scenario: string; wins: number }[] {
  const { scenarios, outcome, lowerIsBetter } = fields.ranking!;
  const measured = fields.outcomes[outcome];
  if (!measured) throw new Error(`The ranking names outcome ${outcome}, but there are ${fields.outcomes.length}`);
  const wins = Object.fromEntries(scenarios.map((scenario) => [scenario, 0]));
  for (const point of points) {
    const scores = scenarios.map((scenario) => measure(model, cachedRun(model, applyAll(model, scenarioSettings(model, scenario), point.parameters)), measured));
    const best = scores.reduce((bestIndex, score, index) => ((lowerIsBetter ? score < scores[bestIndex] : score > scores[bestIndex]) ? index : bestIndex), 0);
    wins[scenarios[best]]++;
  }
  return scenarios.map((scenario) => ({ scenario, wins: points.length ? wins[scenario] / points.length : NaN }));
}

function applyAll(model: StockFlowModelDoc, settings: Settings, parameters: Record<ParameterId, number>): Settings {
  let next = settings;
  for (const [id, value] of Object.entries(parameters)) next = withKnob(model, next, id, value);
  return next;
}

function outcomes(model: StockFlowModelDoc, settings: Settings, list: Outcome[]): number[] {
  const run = cachedRun(model, settings);
  return list.map((outcome) => measure(model, run, outcome));
}

function round(value: number): number {
  return Number(value.toPrecision(10));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
