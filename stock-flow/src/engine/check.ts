import { causalGraph, equationLinks } from "./graph.ts";
import { names, parse, type Node } from "./expr.ts";
import { balancedSettings, orderedScenarios, scenarioSettings } from "./scenarios.ts";
import { evaluationOrder, simulate, splitLink } from "./simulate.ts";
import { unitIssues } from "./units.ts";
import type { StockFlowModelDoc } from "../types.ts";

export type Issue = { severity: "error" | "warning"; where: string; message: string };

/** Structural checks first; the run checks only when the structure is sound. */
export function checkModel(model: StockFlowModelDoc): Issue[] {
  const issues = structuralIssues(model);
  if (issues.some((issue) => issue.severity === "error")) return issues;
  return [...issues, ...unitIssues(model), ...runIssues(model)];
}

function structuralIssues(model: StockFlowModelDoc): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string) => issues.push({ severity: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ severity: "warning", where, message });
  const variables = model.variables;
  const parameters = model.parameters;

  for (const id of Object.keys(parameters)) {
    if (id in variables) error(`parameters.${id}`, `"${id}" is both a parameter and a variable`);
  }
  for (const id of [...Object.keys(parameters), ...Object.keys(variables)]) {
    if (id === "time") error(id, `"time" is reserved for the model year`);
  }

  const readExpr = (where: string, source: string, allowed: (name: string) => boolean, inputAtAllowed: boolean) => {
    let node: Node;
    try {
      node = parse(source);
    } catch (problem) {
      error(where, (problem as Error).message);
      return;
    }
    for (const name of names(node)) if (!allowed(name)) error(where, `Unknown name "${name}"`);
    if (!inputAtAllowed && /\binputAt\s*\(/.test(source)) error(where, "inputAt(…) only works in initial values and derived parameters");
  };
  const isParameter = (name: string) => name in parameters;
  const isInput = (name: string) => variables[name]?.kind === "input";

  for (const [id, parameter] of Object.entries(parameters)) {
    if ("derived" in parameter) readExpr(`parameters.${id}.derived`, parameter.derived, (name) => isParameter(name) || isInput(name), true);
  }
  for (const [id, variable] of Object.entries(variables)) {
    const where = `variables.${id}`;
    if (!variable.unit) warn(where, "No unit");
    if (variable.kind === "stock") {
      readExpr(`${where}.initial`, variable.initial, (name) => isParameter(name) || isInput(name), true);
      for (const flow of [...variable.inflows, ...variable.outflows]) {
        const kind = variables[flow]?.kind;
        if (kind !== "flow" && kind !== "input") error(where, `"${flow}" in its flows is ${kind ? `an ${kind}` : "not a variable"}, not a flow`);
      }
    } else if (variable.kind === "input") {
      readExpr(`${where}.base`, variable.base, isParameter, false);
    } else {
      readExpr(`${where}.equation`, variable.equation, (name) => name === "time" || isParameter(name) || name in variables, false);
    }
  }
  const usedFlows = new Set(
    Object.values(variables).flatMap((variable) => (variable.kind === "stock" ? [...variable.inflows, ...variable.outflows] : [])),
  );
  for (const [id, variable] of Object.entries(variables)) {
    if (variable.kind === "flow" && !usedFlows.has(id)) warn(`variables.${id}`, "A flow that fills or drains no stock; make it an auxiliary");
  }
  if (issues.some((issue) => issue.severity === "error")) return issues;
  try {
    evaluationOrder(model);
  } catch (problem) {
    error("variables", (problem as Error).message);
    return issues;
  }

  const links = new Set(equationLinks(model));
  const checkLink = (where: string, key: string) => {
    try {
      const [from, to] = splitLink(key);
      if (!links.has(`${from}→${to}`)) error(where, `"${key}" is not a link in the equations`);
      else if (variables[to].kind === "stock") error(where, `"${key}" ends in a stock; cut a link into one of the equations instead`);
    } catch (problem) {
      error(where, (problem as Error).message);
    }
  };
  for (const [id, loop] of Object.entries(model.annotations.loops)) {
    if (!loop.cut.length) error(`annotations.loops.${id}`, "Name at least one link a knockout cuts");
    for (const key of loop.cut) checkLink(`annotations.loops.${id}.cut`, key);
  }
  for (const [id, series] of Object.entries(model.data)) {
    if (!(series.variable in variables)) error(`data.${id}`, `Compared with "${series.variable}", which is not a variable`);
  }
  for (const [id, scenario] of Object.entries(model.scenarios)) {
    const where = `scenarios.${id}`;
    if (scenario.base && !(scenario.base in model.scenarios)) error(where, `Base "${scenario.base}" is not a scenario`);
    for (const key of Object.keys(scenario.changes.parameters ?? {})) {
      if (!(key in parameters)) error(where, `Changes "${key}", which is not a parameter`);
      else if ("derived" in parameters[key]) error(where, `Changes "${key}", which is derived from other parameters`);
    }
    for (const [key, curve] of Object.entries(scenario.changes.inputs ?? {})) {
      if (!isInput(key)) error(where, `Draws "${key}", which is not an input`);
      if (curve.length !== model.simulation.years + 1) warn(where, `"${key}" has ${curve.length} yearly values, not ${model.simulation.years + 1}`);
    }
    for (const key of Object.keys(scenario.changes.linkGain ?? {})) checkLink(where, key);
  }
  for (const [view, layout] of Object.entries(model.layout ?? {})) {
    for (const id of Object.keys(layout.nodes)) if (!(id in variables)) error(`layout.${view}.nodes`, `"${id}" is not a variable`);
    for (const id of Object.keys(layout.markers ?? {})) if (!(id in model.annotations.loops)) error(`layout.${view}.markers`, `"${id}" is not a named loop`);
  }
  return issues;
}

function runIssues(model: StockFlowModelDoc): Issue[] {
  const issues: Issue[] = [];
  const balanced = model.scenarios.balanced ? scenarioSettings(model, "balanced") : balancedSettings(model);
  const run = simulate(model, balanced);
  for (const [id, variable] of Object.entries(model.variables)) {
    if (variable.kind !== "stock") continue;
    const values = run.values[id];
    if (values.some((value) => !Number.isFinite(value))) {
      issues.push({ severity: "error", where: `variables.${id}`, message: "Not a number in the balanced run" });
      continue;
    }
    const drift = Math.max(...values.map((value) => Math.abs(value - values[0]))) / (Math.abs(values[0]) || 1);
    if (drift > 1e-6) {
      issues.push({ severity: "warning", where: `variables.${id}`, message: `Drifts ${(drift * 100).toPrecision(2)}% in the balanced run, which should stay put` });
    }
  }

  const [first] = orderedScenarios(model);
  if (first) {
    const settings = scenarioSettings(model, first[0]);
    const coarse = simulate(model, settings);
    const fine = simulate(model, { ...settings, dt: settings.dt / 2 });
    for (const [id, variable] of Object.entries(model.variables)) {
      if (variable.kind !== "stock") continue;
      const size = Math.max(...fine.values[id].map(Math.abs)) || 1;
      const worst = Math.max(
        ...coarse.years.map((year, index) => Math.abs(coarse.values[id][index] - fine.values[id][fine.years.indexOf(year)]) / size),
      );
      if (worst > 0.02) {
        issues.push({
          severity: "warning",
          where: `variables.${id}`,
          message: `Halving dt changes it by up to ${(worst * 100).toFixed(1)}% in "${first[0]}": integration error`,
        });
      }
    }
    const graph = causalGraph(model, coarse, settings);
    const shown = new Set(graph.links.map((link) => `${link.from}→${link.to}`));
    for (const key of Object.keys(model.annotations.links)) {
      if (!shown.has(key)) issues.push({ severity: "warning", where: `annotations.links`, message: `"${key}" is not a link in the loop view` });
    }
    const named = new Set(graph.loops.flatMap((loop) => loop.named));
    for (const id of Object.keys(model.annotations.loops)) {
      if (!named.has(id)) issues.push({ severity: "warning", where: `annotations.loops.${id}`, message: "No cycle passes through its cut links" });
    }
    for (const [view, layout] of Object.entries(model.layout ?? {})) {
      const drawn = causalGraph(model, coarse, settings, { visible: Object.keys(layout.nodes) });
      const links = new Set(drawn.links.map((link) => `${link.from}→${link.to}`));
      for (const key of Object.keys(layout.bends ?? {})) {
        if (!links.has(key)) issues.push({ severity: "warning", where: `layout.${view}.bends`, message: `"${key}" is not a link in this view` });
      }
    }
  }
  return issues;
}
