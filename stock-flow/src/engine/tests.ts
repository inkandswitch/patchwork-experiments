import { checkModel } from "./check.ts";
import { describeFit, fitStats } from "./fit.ts";
import { balancedSettings, cachedRun, scenarioSettings, withKnob } from "./scenarios.ts";
import type { Expectation, FitStats, Run, Settings, StockFlowModelDoc, StockFlowTestsDoc, TestResult, TestSpec } from "../types.ts";

export type TestFields = Pick<StockFlowTestsDoc, "scenario" | "tests">;

/** Runs every test in the battery against the model; nothing here proves the model right, it only shows where it fails. */
export function runTests(model: StockFlowModelDoc, fields: TestFields): TestResult[] {
  return fields.tests.map((spec) => {
    try {
      return runTest(model, fields.scenario, spec);
    } catch (error) {
      return { spec, status: "fail", summary: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Throws when a test names something the model doesn't have, without running anything. */
export function checkTests(model: StockFlowModelDoc, fields: TestFields): void {
  scenarioSettings(model, fields.scenario);
  const variable = (id: string, where: string) => {
    if (!(id in model.variables)) throw new Error(`Unknown variable "${id}" in ${where}`);
  };
  for (const spec of fields.tests) {
    const where = testLabel(spec);
    if (spec.kind === "knockout") {
      if (!(spec.loop in model.annotations.loops)) throw new Error(`Unknown loop "${spec.loop}" in ${where}`);
      variable(spec.variable, where);
    } else if (spec.kind === "extreme") {
      for (const knob of Object.keys(spec.set ?? {})) {
        if (knob !== "dt" && !(knob in model.parameters) && !(knob in model.annotations.loops)) throw new Error(`Unknown knob "${knob}" in ${where}`);
      }
      for (const id of Object.keys(spec.inputs ?? {})) if (model.variables[id]?.kind !== "input") throw new Error(`"${id}" is not an input in ${where}`);
      for (const expectation of spec.expect) variable(expectation.variable, where);
    } else if (spec.kind === "fit" || spec.kind === "holdout") {
      if (!(spec.data in model.data)) throw new Error(`Unknown data series "${spec.data}" in ${where}`);
    }
  }
}

export function runTest(model: StockFlowModelDoc, scenario: string, spec: TestSpec): TestResult {
  switch (spec.kind) {
    case "structure":
      return structure(model, spec);
    case "equilibrium":
      return equilibrium(model, spec);
    case "integration":
      return integration(model, scenario, spec);
    case "extreme":
      return extreme(model, scenario, spec);
    case "knockout":
      return knockout(model, scenario, spec);
    case "fit":
      return fit(model, scenario, spec);
    case "holdout":
      return holdout(model, scenario, spec);
  }
}

export function testLabel(spec: TestSpec): string {
  switch (spec.kind) {
    case "structure":
      return "Structure, references and parameter sources";
    case "equilibrium":
      return "Equilibrium without inputs";
    case "integration":
      return "Integration error (dt halved)";
    case "extreme":
      return `Extreme: ${spec.label}`;
    case "knockout":
      return `Knockout ${spec.loop} moves ${spec.variable}`;
    case "fit":
      return `Fit to ${spec.data}${spec.years ? ` ${spec.years[0]}–${spec.years[1]}` : ""}`;
    case "holdout":
      return `Holdout ${spec.data}: fit ${spec.fitYears[0]}–${spec.fitYears[1]}, test ${spec.testYears[0]}–${spec.testYears[1]}`;
  }
}

function structure(model: StockFlowModelDoc, spec: TestSpec): TestResult {
  const issues = checkModel(model);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const unsourced = Object.entries(model.parameters).filter(([, parameter]) => "value" in parameter && !parameter.source && !parameter.estimated);
  const parts = [
    errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors.map((issue) => `${issue.where} ${issue.message}`).join("; ")}` : "",
    warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.map((issue) => `${issue.where} ${issue.message}`).join("; ")}` : "",
    unsourced.length ? `${unsourced.length} parameter${unsourced.length === 1 ? "" : "s"} without a source or estimation note: ${unsourced.map(([id]) => id).join(", ")}` : "",
  ].filter(Boolean);
  return {
    spec,
    status: errors.length ? "fail" : warnings.length || unsourced.length ? "warn" : "pass",
    summary: parts.join(". ") || "No issues; every parameter has a source",
    details: { errors: errors.length, warnings: warnings.length, unsourced: unsourced.length },
  };
}

function equilibrium(model: StockFlowModelDoc, spec: Extract<TestSpec, { kind: "equilibrium" }>): TestResult {
  const tolerance = spec.tolerance ?? 1e-6;
  const run = cachedRun(model, model.scenarios.balanced ? scenarioSettings(model, "balanced") : balancedSettings(model));
  const drifts = stocks(model).map((id) => {
    const values = run.values[id];
    const drift = Math.max(...values.map((value) => Math.abs(value - values[0]))) / (Math.abs(values[0]) || 1);
    return [id, drift] as const;
  });
  const moving = drifts.filter(([, drift]) => !(drift <= tolerance));
  return {
    spec,
    status: moving.length ? "fail" : "pass",
    summary: moving.length
      ? `Drifts with no inputs: ${moving.map(([id, drift]) => `${id} ${(drift * 100).toPrecision(2)}%`).join(", ")}`
      : `Every stock stays within ${tolerance} of its start over ${model.simulation.years} years`,
    details: Object.fromEntries(drifts),
  };
}

function integration(model: StockFlowModelDoc, scenario: string, spec: Extract<TestSpec, { kind: "integration" }>): TestResult {
  const tolerance = spec.tolerance ?? 0.02;
  const settings = scenarioSettings(model, scenario);
  const coarse = cachedRun(model, settings);
  const fine = cachedRun(model, { ...settings, dt: settings.dt / 2 });
  const changes = stocks(model).map((id) => {
    const size = Math.max(...fine.values[id].map(Math.abs)) || 1;
    const worst = Math.max(...coarse.years.map((year, index) => Math.abs(coarse.values[id][index] - fine.values[id][fine.years.indexOf(year)]) / size));
    return [id, worst] as const;
  });
  const bad = changes.filter(([, change]) => change > tolerance);
  return {
    spec,
    status: bad.length ? "fail" : "pass",
    summary: bad.length
      ? `Halving dt from 1/${Math.round(1 / settings.dt)} changes ${bad.map(([id, change]) => `${id} by ${(change * 100).toFixed(1)}%`).join(", ")}`
      : `Halving dt from 1/${Math.round(1 / settings.dt)} changes no stock by more than ${(Math.max(...changes.map(([, change]) => change)) * 100).toFixed(2)}%`,
    details: Object.fromEntries(changes),
  };
}

function extreme(model: StockFlowModelDoc, scenario: string, spec: Extract<TestSpec, { kind: "extreme" }>): TestResult {
  let settings = scenarioSettings(model, scenario);
  for (const [knob, value] of Object.entries(spec.set ?? {})) settings = withKnob(model, settings, knob, value);
  settings = holdInputs(model, settings, spec.inputs ?? {});
  const run = cachedRun(model, settings);
  const failures = spec.expect.flatMap((expectation) => {
    const problem = checkExpectation(model, run, expectation);
    return problem ? [problem] : [];
  });
  return {
    spec,
    status: failures.length ? "fail" : "pass",
    summary: failures.length ? failures.join("; ") : `${spec.expect.length} expectation${spec.expect.length === 1 ? "" : "s"} hold`,
  };
}

function knockout(model: StockFlowModelDoc, scenario: string, spec: Extract<TestSpec, { kind: "knockout" }>): TestResult {
  if (!(spec.loop in model.annotations.loops)) throw new Error(`Unknown loop "${spec.loop}"`);
  if (!(spec.variable in model.variables)) throw new Error(`Unknown variable "${spec.variable}"`);
  const base = cachedRun(model, scenarioSettings(model, scenario));
  const cut = cachedRun(model, scenarioSettings(model, `${scenario} without ${spec.loop}`));
  const values = base.values[spec.variable];
  const range = Math.max(...values) - Math.min(...values) || Math.abs(values[0]) || 1;
  const effect = Math.max(...values.map((value, index) => Math.abs(cut.values[spec.variable][index] - value))) / range;
  const label = model.annotations.loops[spec.loop];
  return {
    spec,
    status: effect >= spec.minEffect ? "pass" : "fail",
    summary: `Cutting ${label.label} ${label.name} moves ${spec.variable} by up to ${(effect * 100).toFixed(1)}% of its range (needs ${(spec.minEffect * 100).toFixed(0)}%)`,
    details: { effect },
  };
}

function fit(model: StockFlowModelDoc, scenario: string, spec: Extract<TestSpec, { kind: "fit" }>): TestResult {
  const run = cachedRun(model, scenarioSettings(model, scenario));
  const stats = fitStats(model, run, spec.data, spec.years);
  const exceeded = exceededLimits(stats, spec.max);
  return {
    spec,
    status: !stats.n ? "fail" : exceeded.length ? "fail" : "pass",
    summary: `${describeFit(stats)}${exceeded.length ? `. Over the limit: ${exceeded.join(", ")}` : ""}`,
    details: { ...stats },
  };
}

function holdout(model: StockFlowModelDoc, scenario: string, spec: Extract<TestSpec, { kind: "holdout" }>): TestResult {
  const run = cachedRun(model, scenarioSettings(model, scenario));
  const inSample = fitStats(model, run, spec.data, spec.fitYears);
  const outOfSample = fitStats(model, run, spec.data, spec.testYears);
  const exceeded = exceededLimits(outOfSample, spec.max);
  const estimated = Object.values(model.parameters).some((parameter) => parameter.estimated);
  return {
    spec,
    status: !outOfSample.n ? "fail" : exceeded.length ? "fail" : estimated ? "pass" : "warn",
    summary: `In sample: ${describeFit(inSample)}. Out of sample: ${describeFit(outOfSample)}${exceeded.length ? `. Over the limit: ${exceeded.join(", ")}` : ""}${estimated ? "" : ". No parameter records an estimation, so nothing was held out yet"}`,
    details: Object.fromEntries([...Object.entries(inSample).map(([key, value]) => [`fit.${key}`, value]), ...Object.entries(outOfSample).map(([key, value]) => [`test.${key}`, value])]),
  };
}

function exceededLimits(stats: FitStats, max: Partial<FitStats> | undefined): string[] {
  return Object.entries(max ?? {}).flatMap(([key, limit]) => {
    const value = stats[key as keyof FitStats];
    return limit !== undefined && !(value <= limit) ? [`${key} ${Number.isFinite(value) ? value.toPrecision(3) : value} > ${limit}`] : [];
  });
}

/** Holds each named input at a constant multiplier for the whole run. */
export function holdInputs(model: StockFlowModelDoc, settings: Settings, multipliers: Record<string, number>): Settings {
  const next = structuredClone(settings);
  for (const [id, multiplier] of Object.entries(multipliers)) {
    if (model.variables[id]?.kind !== "input") throw new Error(`"${id}" is not an input`);
    next.inputs[id] = Array.from({ length: model.simulation.years + 1 }, () => multiplier);
  }
  return next;
}

/** The problem with an expectation, or undefined when it holds. */
export function checkExpectation(model: StockFlowModelDoc, run: Run, expectation: Expectation): string | undefined {
  const variable = model.variables[expectation.variable];
  if (!variable) return `Unknown variable "${expectation.variable}"`;
  const scale = variable.scale ?? 1;
  const values = run.values[expectation.variable].map((value) => value * scale);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const id = expectation.variable;
  const number = (value: number) => (Math.abs(value) < 10 ? value.toPrecision(3) : Math.round(value).toLocaleString("en"));
  switch (expectation.check) {
    case "finite":
      return values.every(Number.isFinite) ? undefined : `${id} is not finite`;
    case "min":
      return low >= (expectation.value as number) - 1e-9 ? undefined : `${id} falls to ${number(low)}, below ${expectation.value}`;
    case "max":
      return high <= (expectation.value as number) + 1e-9 ? undefined : `${id} rises to ${number(high)}, above ${expectation.value}`;
    case "between": {
      const [a, b] = expectation.value as [number, number];
      return low >= a - 1e-9 && high <= b + 1e-9 ? undefined : `${id} ranges ${number(low)} to ${number(high)}, outside ${a}–${b}`;
    }
    case "settles": {
      const target = expectation.value as number;
      const range = high - low || Math.abs(values[0]) || 1;
      const final = values[values.length - 1];
      return Math.abs(final - target) <= range * 0.01 ? undefined : `${id} ends at ${number(final)}, not ${target}`;
    }
  }
}

function stocks(model: StockFlowModelDoc): string[] {
  return Object.keys(model.variables).filter((id) => model.variables[id].kind === "stock");
}
