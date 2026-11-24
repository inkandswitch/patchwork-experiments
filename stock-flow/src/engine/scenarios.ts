import { simulate, splitLink } from "./simulate.ts";
import type { LinkKey, Run, Scenario, ScenarioId, Settings, StockFlowModelDoc } from "../types.ts";

/**
 * A reference names a scenario, optionally with loops or links cut:
 * "real", "real without spillover and land", "real without rent→profitability".
 */
export function scenarioSettings(model: StockFlowModelDoc, reference: string): Settings {
  const { scenario, cuts } = parseReference(reference);
  const settings = scenario === "balanced" && !model.scenarios.balanced ? balancedSettings(model) : resolve(model, scenario, []);
  for (const cut of cuts) for (const link of cutLinks(model, cut)) settings.linkGain[link] = 0;
  return settings;
}

export function scenarioLabel(model: StockFlowModelDoc, reference: string): string {
  const { scenario, cuts } = parseReference(reference);
  const label = model.scenarios[scenario]?.label ?? scenario;
  if (!cuts.length) return label;
  const names = cuts.map((cut) => {
    const loop = model.annotations.loops[cut];
    return loop ? `${loop.label} ${loop.name}` : cut;
  });
  return `${label} without ${names.join(" and ")}`;
}

export function balancedSettings(model: StockFlowModelDoc): Settings {
  const parameters: Record<string, number> = {};
  for (const [id, parameter] of Object.entries(model.parameters)) if ("value" in parameter) parameters[id] = parameter.value;
  return { parameters, inputs: {}, linkGain: {}, dt: model.simulation.dt };
}

export function orderedScenarios(model: StockFlowModelDoc): [ScenarioId, Scenario][] {
  return Object.entries(model.scenarios).sort(([, a], [, b]) => a.order - b.order);
}

/** A parameter, a loop (the gain of the links it cuts), or "dt". */
export function withKnob(model: StockFlowModelDoc, settings: Settings, knob: string, value: number): Settings {
  const next = structuredClone(settings);
  if (knob === "dt") next.dt = value;
  else if (knob in model.parameters) {
    if (!("value" in model.parameters[knob])) throw new Error(`"${knob}" is derived from other parameters; sweep one of those`);
    next.parameters[knob] = value;
  } else if (knob in model.annotations.loops) for (const link of model.annotations.loops[knob].cut) next.linkGain[link] = value;
  else throw new Error(`Unknown knob "${knob}": use a parameter, a loop or dt`);
  return next;
}

/** Runs are cached by model version and settings, so charts sharing a scenario simulate it once. */
export function cachedRun(model: StockFlowModelDoc, settings: Settings): Run {
  let runs = RUNS.get(model);
  if (!runs) {
    runs = new Map();
    RUNS.set(model, runs);
  }
  const key = JSON.stringify(settings);
  let run = runs.get(key);
  if (!run) {
    run = simulate(model, settings);
    runs.set(key, run);
  }
  return run;
}

function parseReference(reference: string): { scenario: ScenarioId; cuts: string[] } {
  const [name, knockouts] = reference.split(/\s+without\s+/);
  const cuts = (knockouts ?? "")
    .split(/\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return { scenario: name.trim(), cuts };
}

function cutLinks(model: StockFlowModelDoc, cut: string): LinkKey[] {
  const loop = model.annotations.loops[cut];
  if (loop) return loop.cut;
  if (/→|->/.test(cut)) {
    const [from, to] = splitLink(cut);
    for (const id of [from, to]) if (!(id in model.variables)) throw new Error(`Unknown variable "${id}" in "${cut}"`);
    return [`${from}→${to}`];
  }
  throw new Error(`Unknown loop "${cut}"; name a loop (${Object.keys(model.annotations.loops).join(", ")}) or a link from→to`);
}

function resolve(model: StockFlowModelDoc, id: ScenarioId, seen: ScenarioId[]): Settings {
  const scenario = model.scenarios[id];
  if (!scenario) throw new Error(`Unknown scenario "${id}"`);
  if (seen.includes(id)) throw new Error(`Scenarios build on each other in a circle: ${[...seen, id].join(" → ")}`);
  const settings = scenario.base ? resolve(model, scenario.base, [...seen, id]) : balancedSettings(model);
  const { parameters, inputs, linkGain, dt } = scenario.changes;
  return {
    parameters: { ...settings.parameters, ...parameters },
    inputs: { ...settings.inputs, ...structuredClone(inputs ?? {}) },
    linkGain: { ...settings.linkGain, ...linkGain },
    dt: dt ?? settings.dt,
  };
}

const RUNS = new WeakMap<StockFlowModelDoc, Map<string, Run>>();
