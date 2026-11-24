import { loss, logistic, logit, restarted, type EstimateSpec } from "./estimate.ts";
import { fitStats, valueAt } from "./fit.ts";
import { scenarioSettings } from "./scenarios.ts";
import { simulate } from "./simulate.ts";
import type { CompareId, FitComparison, FitRestart, ParameterId, Settings, StockFlowFitDoc, StockFlowModelDoc } from "../types.ts";

/**
 * What a fit run needs. Several models share the parameters (a panel); each comparison is weighted, and the holdout
 * years may not overlap the fit window.
 */
export type FitRunSpec = {
  scenario: string;
  parameters: Record<ParameterId, { min: number; max: number }>;
  compare: Record<CompareId, number>;
  years: [number, number];
  holdout?: [number, number];
  /** The first start is the model's current values; the others are drawn inside the bounds from `seed`. */
  starts: number;
  seed: number;
  /** Nelder–Mead evaluations per start; 80 per parameter by default. */
  maxEvaluations?: number;
  profile?: boolean;
};

/** Everything a fit-run document records about the search; the comparisons name their model by index into the panel. */
export type FitRunResult = Pick<StockFlowFitDoc, "restarts" | "values" | "objectiveValue" | "atBound" | "profiles"> & {
  maxEvaluations: number;
  comparisons: (Omit<FitComparison, "model"> & { model: number })[];
};

/**
 * Bounded least squares from several starts (Sterman §21.4.5). Keeping every start's end point shows whether the
 * optimum is unique; the profiles show whether each parameter is identified at all.
 */
export function fitRun(models: StockFlowModelDoc[], spec: FitRunSpec): FitRunResult {
  checkFitRun(models, spec);
  const ids = Object.keys(spec.parameters);
  const settings = models.map((model) => scenarioSettings(model, spec.scenario));
  const objective = panelObjective(models, settings, spec);
  const budget = spec.maxEvaluations ?? 80 * ids.length;
  const bounds = boundsMap(spec.parameters);
  const random = seeded(spec.seed);
  const initial = Object.fromEntries(ids.map((id) => [id, settings[0].parameters[id]]));
  const starts = [initial, ...Array.from({ length: Math.max(0, spec.starts - 1) }, () => bounds.random(random))];

  const ends = starts.map((start) => bounds.fromFree(restarted((point) => objective(bounds.fromFree(point)), bounds.toFree(start), budget)));
  const restarts: FitRestart[] = starts.map((start, index) => ({ start: tidy(start), end: tidy(ends[index]), objective: objective(ends[index]) }));
  const bestIndex = restarts.reduce((best, restart, index) => (restart.objective < restarts[best].objective ? index : best), 0);
  const values = ends[bestIndex];

  return {
    restarts,
    values: tidy(values),
    objectiveValue: restarts[bestIndex].objective,
    atBound: ids.filter((id) => bounds.position(id, values[id]) <= 0.005 || bounds.position(id, values[id]) >= 0.995),
    comparisons: models.flatMap((model, index) => comparisons(model, settings[index], values, spec).map((comparison) => ({ ...comparison, model: index }))),
    ...(spec.profile ? { profiles: profiles(values, spec, objective, budget) } : {}),
    maxEvaluations: budget,
  };
}

/** The objective at given values: whether models that changed since a fit still give the objective it recorded. */
export function objectiveAt(models: StockFlowModelDoc[], spec: Pick<FitRunSpec, "scenario" | "parameters" | "compare" | "years">, values: Record<ParameterId, number>): number {
  const settings = models.map((model) => scenarioSettings(model, spec.scenario));
  return panelObjective(models, settings, spec)(values);
}

export function checkFitRun(models: StockFlowModelDoc[], spec: FitRunSpec): void {
  if (!models.length) throw new Error("Fit at least one model");
  if (!Object.keys(spec.parameters).length) throw new Error("Name the parameters to estimate");
  if (!Object.keys(spec.compare).length) throw new Error("Name at least one comparison to fit");
  if (!(spec.years[0] < spec.years[1])) throw new Error("The fit window needs a start before its end");
  if (spec.holdout && spec.holdout[0] <= spec.years[1] && spec.holdout[1] >= spec.years[0]) {
    throw new Error(`The holdout ${spec.holdout.join("–")} overlaps the fit window ${spec.years.join("–")}`);
  }
  for (const model of models) {
    for (const [id, range] of Object.entries(spec.parameters)) {
      const parameter = model.parameters[id];
      if (!parameter) throw new Error(`${model.title} has no parameter "${id}"`);
      if (!("value" in parameter)) throw new Error(`"${id}" is derived in ${model.title}; estimate one of the parameters it is derived from`);
      if (!(range.min < range.max)) throw new Error(`"${id}" needs min < max`);
    }
    for (const id of Object.keys(spec.compare)) {
      if (!model.data[id]) throw new Error(`${model.title} compares nothing called "${id}"`);
      if (model.data[id].variable === undefined) throw new Error(`"${id}" is not compared with a variable in ${model.title}`);
    }
  }
}

/** The weighted normalised squared error, summed over the panel's models. */
function panelObjective(
  models: StockFlowModelDoc[],
  settings: Settings[],
  spec: Pick<FitRunSpec, "scenario" | "parameters" | "compare" | "years">,
): (values: Record<ParameterId, number>) => number {
  const estimateSpec: EstimateSpec = {
    scenario: spec.scenario,
    parameters: spec.parameters,
    data: Object.entries(spec.compare).map(([series, weight]) => ({ series, weight })),
    years: spec.years,
  };
  return (values) => models.reduce((sum, model, index) => sum + loss(model, applied(settings[index], values), estimateSpec), 0);
}

function comparisons(model: StockFlowModelDoc, settings: Settings, values: Record<ParameterId, number>, spec: FitRunSpec): Omit<FitComparison, "model">[] {
  const run = simulate(model, applied(settings, values));
  return Object.keys(spec.compare).map((compare) => {
    const series = model.data[compare];
    const variable = series.variable!;
    const scale = model.variables[variable]?.scale ?? 1;
    const inWindow = (year: number) => year >= spec.years[0] && year <= spec.years[1];
    return {
      compare,
      inSample: fitStats(model, run, compare, spec.years),
      ...(spec.holdout ? { holdout: fitStats(model, run, compare, spec.holdout) } : {}),
      residuals: series.points
        .map(([year, data]) => ({ year, model: tidyNumber(valueAt(run, variable, year) * scale), data, inSample: inWindow(year) }))
        .filter(({ model }) => Number.isFinite(model)),
    };
  });
}

/** Each parameter stepped across its bounds with the others re-fitted from the best values. */
function profiles(
  best: Record<ParameterId, number>,
  spec: FitRunSpec,
  objective: (values: Record<ParameterId, number>) => number,
  budget: number,
): Record<ParameterId, { value: number; objective: number }[]> {
  const ids = Object.keys(spec.parameters);
  return Object.fromEntries(
    ids.map((id) => {
      const others = ids.filter((other) => other !== id);
      const { min, max } = spec.parameters[id];
      const points = Array.from({ length: 9 }, (_, step) => {
        const value = min + ((max - min) * (step + 0.5)) / 9;
        if (!others.length) return { value: tidyNumber(value), objective: tidyNumber(objective({ [id]: value })) };
        const bounds = boundsMap(Object.fromEntries(others.map((other) => [other, spec.parameters[other]])));
        const fixed = (free: number[]) => ({ ...bounds.fromFree(free), [id]: value });
        const start = Object.fromEntries(others.map((other) => [other, best[other]]));
        const end = restarted((free) => objective(fixed(free)), bounds.toFree(start), Math.ceil(budget / 2));
        return { value: tidyNumber(value), objective: tidyNumber(objective(fixed(end))) };
      });
      return [id, points];
    }),
  );
}

/** The search runs in an unbounded space mapped onto the bounds by a logistic curve, as in `estimate`. */
function boundsMap(parameters: Record<ParameterId, { min: number; max: number }>) {
  const ids = Object.keys(parameters);
  const position = (id: ParameterId, value: number) => (value - parameters[id].min) / (parameters[id].max - parameters[id].min);
  return {
    position,
    toFree: (values: Record<ParameterId, number>) => ids.map((id) => logit(Math.min(0.98, Math.max(0.02, position(id, values[id]))))),
    fromFree: (point: number[]) =>
      Object.fromEntries(ids.map((id, i) => [id, parameters[id].min + logistic(point[i]) * (parameters[id].max - parameters[id].min)])),
    random: (next: () => number) =>
      Object.fromEntries(ids.map((id) => [id, parameters[id].min + (0.05 + 0.9 * next()) * (parameters[id].max - parameters[id].min)])),
  };
}

function applied(settings: Settings, values: Record<ParameterId, number>): Settings {
  return { ...settings, parameters: { ...settings.parameters, ...values } };
}

/** mulberry32: the same seed draws the same starts. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tidy(values: Record<ParameterId, number>): Record<ParameterId, number> {
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, tidyNumber(value)]));
}

function tidyNumber(value: number): number {
  return Number(value.toPrecision(6));
}
