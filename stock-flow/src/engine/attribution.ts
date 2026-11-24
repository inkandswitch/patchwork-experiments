import { checkOutcome, measure } from "./outcomes.ts";
import { cachedRun, scenarioSettings, withKnob } from "./scenarios.ts";
import { latinHypercube, parameterRanges } from "./sensitivity.ts";
import { holdInputs } from "./tests.ts";
import type { Attribution, Quantiles, Settings, StockFlowAttributionDoc, StockFlowModelDoc } from "../types.ts";

export type AttributionFields = Pick<StockFlowAttributionDoc, "scenario" | "outcome" | "drivers" | "uncertainty">;

/**
 * Shapley attribution: runs the scenario with every subset of drivers switched off and credits each driver with its
 * average marginal contribution over all orderings. The shares add up to the difference between the full scenario and
 * the run with every driver off, however the drivers interact.
 */
export function attribute(model: StockFlowModelDoc, fields: AttributionFields): Attribution {
  checkOutcome(model, fields.outcome);
  const ids = Object.keys(fields.drivers);
  if (!ids.length) throw new Error("Name at least one driver");
  if (ids.length > 10) throw new Error(`${ids.length} drivers means ${2 ** ids.length} runs; keep it to 10 or fewer`);
  const full = scenarioSettings(model, fields.scenario);
  const result = attributeFrom(model, fields, full);
  return fields.uncertainty ? { ...result, bands: bands(model, fields, full) } : result;
}

/**
 * The attribution repeated over a Latin hypercube of uncertain parameters: how much the shares depend on the numbers
 * we are unsure of. Each sample reruns every subset of drivers with the sampled parameters.
 */
function bands(model: StockFlowModelDoc, fields: AttributionFields, full: Settings): NonNullable<Attribution["bands"]> {
  const { parameters, samples, seed } = fields.uncertainty!;
  if (!(samples >= 2)) throw new Error("Uncertainty bands need at least 2 samples");
  const ranges = parameterRanges(model, full, parameters);
  const results = latinHypercube(ranges, samples, seed).map((point) => {
    let settings = full;
    for (const [id, value] of Object.entries(point.parameters)) settings = withKnob(model, settings, id, value);
    return attributeFrom(model, fields, settings);
  });
  const ids = Object.keys(fields.drivers);
  return {
    samples,
    shares: Object.fromEntries(ids.map((id) => [id, quantiles(results.map((r) => r.shares[id]))])),
    total: quantiles(results.map((r) => r.total)),
  };
}

export function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    const position = q * (sorted.length - 1);
    const below = Math.floor(position);
    const above = Math.min(sorted.length - 1, below + 1);
    return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
  };
  return { low: at(0.05), median: at(0.5), high: at(0.95) };
}

function attributeFrom(model: StockFlowModelDoc, fields: AttributionFields, full: Settings): Attribution {
  const ids = Object.keys(fields.drivers);
  const value = new Map<string, number>();
  const measured = (on: Set<string>): number => {
    const key = ids.map((id) => (on.has(id) ? "1" : "0")).join("");
    let result = value.get(key);
    if (result === undefined) {
      result = measure(model, cachedRun(model, withDriversOff(model, fields, full, ids.filter((id) => !on.has(id)))), fields.outcome);
      value.set(key, result);
    }
    return result;
  };
  const baseline = measured(new Set());
  const total = measured(new Set(ids)) - baseline;
  const n = ids.length;
  const shares: Record<string, number> = {};
  for (const id of ids) {
    let share = 0;
    for (const subset of subsets(ids.filter((other) => other !== id))) {
      const weight = (factorial(subset.length) * factorial(n - subset.length - 1)) / factorial(n);
      share += weight * (measured(new Set([...subset, id])) - measured(new Set(subset)));
    }
    shares[id] = share;
  }
  const oneAtATime = Object.fromEntries(ids.map((id) => [id, measured(new Set([id])) - baseline]));
  const interaction = total - Object.values(oneAtATime).reduce((sum, effect) => sum + effect, 0);
  return { baseline, total, shares, oneAtATime, interaction };
}

function withDriversOff(model: StockFlowModelDoc, fields: AttributionFields, settings: Settings, off: string[]): Settings {
  let next = settings;
  for (const id of off) {
    const driver = fields.drivers[id];
    const held = Object.fromEntries((driver.inputs ?? []).map((input) => [input, settings.inputs[input]?.[0] ?? 1]));
    next = holdInputs(model, next, held);
    for (const [parameter, value] of Object.entries(driver.parameters ?? {})) next = withKnob(model, next, parameter, value);
  }
  return next;
}

function* subsets<T>(items: T[]): Generator<T[]> {
  for (let mask = 0; mask < 2 ** items.length; mask++) yield items.filter((_, index) => mask & (1 << index));
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
