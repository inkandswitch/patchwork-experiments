import type { FitStats, Run, SeriesId, StockFlowModelDoc } from "../types.ts";

/**
 * Behaviour reproduction statistics (Sterman §21.4.7) for a run against one data series, over the data's years or a window.
 * Model values are scaled the way charts show them, so they are in the data's units.
 */
export function fitStats(model: StockFlowModelDoc, run: Run, data: SeriesId, years?: [number, number]): FitStats {
  const series = model.data[data];
  if (!series) throw new Error(`Unknown data series "${data}"`);
  const scale = model.variables[series.variable]?.scale ?? 1;
  const pairs = series.points
    .filter(([year]) => !years || (year >= years[0] && year <= years[1]))
    .map(([year, actual]) => [valueAt(run, series.variable, year) * scale, actual] as [number, number])
    .filter(([simulated]) => Number.isFinite(simulated));
  return statistics(pairs);
}

/** The run's value of a variable at a year, interpolated between recorded points; NaN outside the run. */
export function valueAt(run: Run, variable: string, year: number): number {
  const values = run.values[variable];
  if (!values) throw new Error(`Unknown variable "${variable}"`);
  const { years } = run;
  if (year < years[0] || year > years[years.length - 1]) return NaN;
  let index = 0;
  while (index < years.length - 2 && years[index + 1] <= year) index++;
  const span = years[index + 1] - years[index] || 1;
  const weight = (year - years[index]) / span;
  return values[index] + (values[index + 1] - values[index]) * weight;
}

/** RMSE, MAPE, R², Theil's U and its decomposition for (simulated, actual) pairs. */
export function statistics(pairs: [number, number][]): FitStats {
  const n = pairs.length;
  if (n === 0) return { n, rmse: NaN, mape: NaN, r2: NaN, theilU: NaN, bias: NaN, variation: NaN, covariation: NaN };
  const simulated = pairs.map(([s]) => s);
  const actual = pairs.map(([, a]) => a);
  const meanS = mean(simulated);
  const meanA = mean(actual);
  const sdS = Math.sqrt(mean(simulated.map((s) => (s - meanS) ** 2)));
  const sdA = Math.sqrt(mean(actual.map((a) => (a - meanA) ** 2)));
  const covariance = mean(pairs.map(([s, a]) => (s - meanS) * (a - meanA)));
  const r = sdS && sdA ? covariance / (sdS * sdA) : 1;
  const mse = mean(pairs.map(([s, a]) => (s - a) ** 2));
  const totalSquares = mean(actual.map((a) => (a - meanA) ** 2));
  const rootMeanSquare = (values: number[]) => Math.sqrt(mean(values.map((value) => value ** 2)));
  return {
    n,
    rmse: Math.sqrt(mse),
    mape: mean(pairs.map(([s, a]) => (a === 0 ? 0 : Math.abs((s - a) / a)))),
    r2: totalSquares ? 1 - mse / totalSquares : NaN,
    theilU: rootMeanSquare(simulated) + rootMeanSquare(actual) ? Math.sqrt(mse) / (rootMeanSquare(simulated) + rootMeanSquare(actual)) : 0,
    bias: mse ? (meanS - meanA) ** 2 / mse : 0,
    variation: mse ? (sdS - sdA) ** 2 / mse : 0,
    covariation: mse ? (2 * (1 - r) * sdS * sdA) / mse : 1,
  };
}

/** "RMSE 0.42 · MAPE 6.1% · R² 0.87 · U 0.04 (bias 12%, variation 3%, covariation 85%)" */
export function describeFit(stats: FitStats, format: (value: number) => string = (value) => value.toPrecision(3)): string {
  if (!stats.n) return "no overlapping points";
  const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
  return `n ${stats.n} · RMSE ${format(stats.rmse)} · MAPE ${(stats.mape * 100).toFixed(1)}% · R² ${stats.r2.toFixed(2)} · Theil U ${stats.theilU.toFixed(3)} (bias ${percent(stats.bias)}, variation ${percent(stats.variation)}, covariation ${percent(stats.covariation)})`;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
