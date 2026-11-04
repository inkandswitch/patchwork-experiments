import { fitStats } from "./fit.ts";
import { scenarioSettings } from "./scenarios.ts";
import { simulate } from "./simulate.ts";
import type { FitStats, ParameterId, SeriesId, Settings, StockFlowModelDoc } from "../types.ts";

/**
 * Parameter estimation (Sterman §21.4.5): bounded least squares of a scenario's run against data series over a
 * fit window. Each series' squared errors are divided by the square of its mean so series in different units
 * weigh alike; `weight` tilts that.
 */
export type EstimateSpec = {
  scenario: string;
  /** Bounds for each parameter to estimate; the search stays inside them. */
  parameters: Record<ParameterId, { min: number; max: number }>;
  data: { series: SeriesId; weight?: number }[];
  years: [number, number];
  /** Nelder–Mead evaluations; 60 per parameter by default. */
  maxEvaluations?: number;
};

export type EstimateResult = {
  initial: Record<ParameterId, number>;
  values: Record<ParameterId, number>;
  loss: { initial: number; final: number };
  fits: Record<SeriesId, FitStats>;
  evaluations: number;
  /** Which estimated values sit on a bound, a sign the range or the structure is wrong. */
  atBound: ParameterId[];
};

export function estimate(model: StockFlowModelDoc, spec: EstimateSpec): EstimateResult {
  checkSpec(model, spec);
  const settings = scenarioSettings(model, spec.scenario);
  const ids = Object.keys(spec.parameters);
  const initial = Object.fromEntries(ids.map((id) => [id, settings.parameters[id] ?? (model.parameters[id] as { value: number }).value]));
  // The search runs in an unbounded space mapped onto the bounds by a logistic curve, so the simplex never sees a
  // flat clamped region and "at a bound" shows up as a very large coordinate.
  const toFree = (values: Record<ParameterId, number>) =>
    ids.map((id) => logit(clamp((values[id] - spec.parameters[id].min) / (spec.parameters[id].max - spec.parameters[id].min), 0.02, 0.98)));
  const fromFree = (point: number[]) =>
    Object.fromEntries(ids.map((id, i) => [id, spec.parameters[id].min + logistic(point[i]) * (spec.parameters[id].max - spec.parameters[id].min)]));
  let evaluations = 0;
  const objective = (point: number[]) => {
    evaluations++;
    return loss(model, applied(settings, fromFree(point)), spec);
  };
  const best = restarted(objective, toFree(initial), spec.maxEvaluations ?? 80 * ids.length);
  const values = fromFree(best);
  const run = simulate(model, applied(settings, values));
  return {
    initial,
    values,
    loss: { initial: loss(model, applied(settings, initial), spec), final: loss(model, applied(settings, values), spec) },
    fits: Object.fromEntries(spec.data.map(({ series }) => [series, fitStats(model, run, series, spec.years)])),
    evaluations,
    atBound: ids.filter((_, i) => logistic(best[i]) <= 0.005 || logistic(best[i]) >= 0.995),
  };
}

export function checkSpec(model: StockFlowModelDoc, spec: EstimateSpec): void {
  for (const [id, range] of Object.entries(spec.parameters)) {
    const parameter = model.parameters[id];
    if (!parameter) throw new Error(`Unknown parameter "${id}"`);
    if (!("value" in parameter)) throw new Error(`"${id}" is derived from other parameters; estimate one of those`);
    if (!(range.min < range.max)) throw new Error(`"${id}" needs min < max`);
  }
  if (!spec.data.length) throw new Error("Name at least one data series to fit");
  for (const { series } of spec.data) {
    if (!model.data[series]) throw new Error(`Unknown data series "${series}"`);
    if (model.data[series].variable === undefined) throw new Error(`"${series}" is not compared with a model variable`);
  }
  if (!(spec.years[0] < spec.years[1])) throw new Error("The fit window needs a start before its end");
}

/** Normalised squared error summed over the series, each weighted. */
export function loss(model: StockFlowModelDoc, settings: Settings, spec: EstimateSpec): number {
  const run = simulate(model, settings);
  let total = 0;
  for (const { series, weight = 1 } of spec.data) {
    const data = model.data[series];
    const variable = data.variable;
    if (variable === undefined) throw new Error(`"${series}" is not compared with a model variable`);
    const scale = model.variables[variable]?.scale ?? 1;
    const points = data.points.filter(([year]) => year >= spec.years[0] && year <= spec.years[1]);
    if (!points.length) continue;
    const mean = points.reduce((sum, [, value]) => sum + Math.abs(value), 0) / points.length || 1;
    let squares = 0;
    for (const [year, actual] of points) {
      const simulated = valueAt(run, variable, year) * scale;
      squares += Number.isFinite(simulated) ? ((simulated - actual) / mean) ** 2 : 1e6;
    }
    total += (weight * squares) / points.length;
  }
  return total;
}

function applied(settings: Settings, values: Record<ParameterId, number>): Settings {
  return { ...settings, parameters: { ...settings.parameters, ...values } };
}

function valueAt(run: { years: number[]; values: Record<string, number[]> }, variable: string, year: number): number {
  const { years } = run;
  if (year < years[0] || year > years[years.length - 1]) return NaN;
  let index = 0;
  while (index < years.length - 2 && years[index + 1] <= year) index++;
  const span = years[index + 1] - years[index] || 1;
  const values = run.values[variable];
  return values[index] + (values[index + 1] - values[index]) * ((year - years[index]) / span);
}

/** Nelder–Mead from the start, then again from each result with a fresh simplex until it stops improving. */
export function restarted(f: (point: number[]) => number, start: number[], maxEvaluations: number): number[] {
  let best = start;
  let bestValue = f(start);
  let used = 1;
  while (used < maxEvaluations) {
    const budget = Math.max(20 * start.length, Math.floor((maxEvaluations - used) / 2));
    let count = 0;
    const counted = (point: number[]) => (count++, f(point));
    const next = nelderMead(counted, best, budget);
    used += count;
    const value = f(next);
    used++;
    if (value < bestValue - 1e-9 * (1 + Math.abs(bestValue))) [best, bestValue] = [next, value];
    else break;
  }
  return best;
}

/** Nelder–Mead downhill simplex; the start simplex steps 0.5 along each axis. */
export function nelderMead(f: (point: number[]) => number, start: number[], maxEvaluations: number): number[] {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + 0.5 : v)))];
  let values = simplex.map(f);
  let evaluations = simplex.length;
  while (evaluations < maxEvaluations) {
    const order = values.map((value, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    if (Math.abs(values[n] - values[0]) < 1e-10 * (1 + Math.abs(values[0])) && spread(simplex) < 1e-6) break;
    const centroid = start.map((_, j) => simplex.slice(0, n).reduce((sum, point) => sum + point[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const reflected = along(-1);
    const fr = f(reflected);
    evaluations++;
    if (fr < values[0]) {
      const expanded = along(-2);
      const fe = f(expanded);
      evaluations++;
      [simplex[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [reflected, fr];
    } else {
      const contracted = along(fr < values[n] ? -0.5 : 0.5);
      const fc = f(contracted);
      evaluations++;
      if (fc < Math.min(fr, values[n])) [simplex[n], values[n]] = [contracted, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = f(simplex[i]);
          evaluations++;
        }
      }
    }
  }
  const bestIndex = values.indexOf(Math.min(...values));
  return simplex[bestIndex];
}

export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(u: number): number {
  return Math.log(u / (1 - u));
}

function spread(simplex: number[][]): number {
  return Math.max(...simplex.slice(1).map((point) => Math.max(...point.map((v, j) => Math.abs(v - simplex[0][j])))));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
