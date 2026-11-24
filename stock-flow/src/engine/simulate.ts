import { compile, names, parse, type Compiled, type Node, type Scope } from "./expr.ts";
import type { LinkKey, Run, Settings, StockFlowModelDoc, Variable, VariableId } from "../types.ts";

/** Euler integration: every step evaluates the flows and auxiliaries from the stocks, then moves each stock by dt × net flow. */
export function simulate(model: StockFlowModelDoc, settings: Settings): Run {
  const evaluator = createEvaluator(model, settings);
  const { dt } = settings;
  const steps = Math.round(model.simulation.years / dt);
  const recordEvery = Math.max(1, Math.round(model.simulation.recordInterval / dt));
  const ids = Object.keys(model.variables);
  const run: Run = { years: [], values: Object.fromEntries(ids.map((id) => [id, []])) };
  const scope = evaluator.initialScope();
  for (let step = 0; step <= steps; step++) {
    scope.time = step * dt;
    evaluator.evaluate(scope);
    if (step % recordEvery === 0) {
      run.years.push(model.simulation.startYear + scope.time);
      for (const id of ids) run.values[id].push(scope[id]);
    }
    const nets = evaluator.stocks.map((stock) => evaluator.netFlow(stock, scope));
    evaluator.stocks.forEach((stock, index) => {
      scope[stock] = scope[stock] + dt * nets[index];
    });
  }
  return run;
}

export type Evaluator = {
  parameters: Scope;
  stocks: VariableId[];
  /** Flows, auxiliaries and inputs in the order they are computed. */
  order: VariableId[];
  initialScope(): Scope;
  /** Computes every flow, auxiliary and input from the stocks and time in the scope. */
  evaluate(scope: Scope): void;
  evaluateOne(id: VariableId, scope: Scope): number;
  netFlow(stock: VariableId, scope: Scope): number;
};

export function createEvaluator(model: StockFlowModelDoc, settings: Settings): Evaluator {
  const parameters = resolveParameters(model, settings);
  const stocks = Object.keys(model.variables).filter((id) => model.variables[id].kind === "stock");
  const order = evaluationOrder(model);
  const refs = needsRefs(settings.linkGain) ? balancedStart(model, settings) : {};
  const compiled: Record<VariableId, Compiled> = {};
  for (const id of order) compiled[id] = compileVariable(model, id, settings, parameters, refs);
  const initials = Object.fromEntries(
    stocks.map((id) => {
      const variable = model.variables[id] as Extract<Variable, { kind: "stock" }>;
      return [id, compile(parsed(variable.initial), () => undefined, inputReader(model, settings, parameters))(parameters)];
    }),
  );
  return {
    parameters,
    stocks,
    order,
    initialScope: () => ({ ...parameters, time: 0, ...initials }),
    evaluate(scope) {
      for (const id of order) scope[id] = compiled[id](scope);
    },
    evaluateOne: (id, scope) => compiled[id](scope),
    netFlow(stock, scope) {
      const variable = model.variables[stock] as Extract<Variable, { kind: "stock" }>;
      let net = 0;
      for (const flow of variable.inflows) net += scope[flow];
      for (const flow of variable.outflows) net -= scope[flow];
      return net;
    },
  };
}

/** Variables a variable reads directly: names in its equation, or a stock's flows. */
export function dependencies(model: StockFlowModelDoc, id: VariableId): VariableId[] {
  const variable = model.variables[id];
  if (variable.kind === "stock") return [...variable.inflows, ...variable.outflows];
  const source = variable.kind === "input" ? variable.base : variable.equation;
  return [...names(parsed(source))].filter((name) => name in model.variables);
}

export function evaluationOrder(model: StockFlowModelDoc): VariableId[] {
  const order: VariableId[] = [];
  const state = new Map<VariableId, "visiting" | "done">();
  const visit = (id: VariableId, path: VariableId[]) => {
    if (state.get(id) === "done" || model.variables[id].kind === "stock") return;
    if (state.get(id) === "visiting") throw new Error(`Equations depend on each other in a circle: ${[...path, id].join(" → ")}`);
    state.set(id, "visiting");
    for (const dependency of dependencies(model, id)) visit(dependency, [...path, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const id of Object.keys(model.variables)) visit(id, []);
  return order;
}

/** Parameter values with every derived parameter computed. */
export function resolveParameters(model: StockFlowModelDoc, settings: Settings): Scope {
  const values: Scope = {};
  const visiting = new Set<string>();
  const value = (id: string): number => {
    if (id in values) return values[id];
    const parameter = model.parameters[id];
    if (!parameter) throw new Error(`Unknown parameter "${id}"`);
    if ("value" in parameter) return (values[id] = settings.parameters[id] ?? parameter.value);
    if (visiting.has(id)) throw new Error(`Derived parameter "${id}" depends on itself`);
    visiting.add(id);
    const resolve = (name: string): Compiled | undefined => {
      if (!(name in model.parameters)) throw new Error(`"${id}" reads "${name}", which is not a parameter`);
      return () => value(name);
    };
    values[id] = compile(parsed(parameter.derived), resolve, inputReader(model, settings, values, value))({});
    visiting.delete(id);
    return values[id];
  };
  for (const id of Object.keys(model.parameters)) value(id);
  return values;
}

/** Linear interpolation between yearly multipliers, held flat past either end. */
export function multiplierAt(curve: number[] | undefined, year: number): number {
  if (!curve?.length) return 1;
  const index = Math.min(Math.max(year, 0), curve.length - 1);
  const before = Math.floor(index);
  const after = Math.min(before + 1, curve.length - 1);
  return curve[before] + (curve[after] - curve[before]) * (index - before);
}

export function parsed(source: string): Node {
  let node = PARSED.get(source);
  if (!node) {
    node = parse(source);
    PARSED.set(source, node);
  }
  return node;
}

export function splitLink(key: LinkKey): [VariableId, VariableId] {
  const [from, to] = key.split(/→|->/).map((part) => part.trim());
  if (!from || !to) throw new Error(`Write a link as from→to, not "${key}"`);
  return [from, to];
}

function compileVariable(
  model: StockFlowModelDoc,
  id: VariableId,
  settings: Settings,
  parameters: Scope,
  refs: Scope,
): Compiled {
  const variable = model.variables[id];
  if (variable.kind === "input") {
    const base = compile(parsed(variable.base))(parameters);
    const curve = settings.inputs[id];
    return (scope) => base * multiplierAt(curve, scope.time);
  }
  if (variable.kind === "stock") throw new Error(`"${id}" is a stock`);
  const gains = gainsInto(settings.linkGain, id);
  const resolve = (name: string): Compiled | undefined => {
    const gain = gains.get(name);
    if (gain === undefined) return undefined;
    const ref = refs[name];
    return (scope) => ref + gain * (scope[name] - ref);
  };
  return compile(parsed(variable.equation), resolve);
}

function gainsInto(linkGain: Record<LinkKey, number>, to: VariableId): Map<VariableId, number> {
  const gains = new Map<VariableId, number>();
  for (const [key, gain] of Object.entries(linkGain)) {
    const [from, target] = splitLink(key);
    if (target === to && gain !== 1) gains.set(from, gain);
  }
  return gains;
}

function needsRefs(linkGain: Record<LinkKey, number>): boolean {
  return Object.values(linkGain).some((gain) => gain !== 1);
}

/** Every variable at the start of the run with the same parameters, all inputs at 1 and no links cut. */
function balancedStart(model: StockFlowModelDoc, settings: Settings): Scope {
  const evaluator = createEvaluator(model, { ...settings, inputs: {}, linkGain: {} });
  const scope = evaluator.initialScope();
  evaluator.evaluate(scope);
  return scope;
}

function inputReader(
  model: StockFlowModelDoc,
  settings: Settings,
  parameters: Scope,
  parameter: (id: string) => number = (id) => parameters[id],
): (input: string, year: number) => number {
  return (input, year) => {
    const variable = model.variables[input];
    if (variable?.kind !== "input") throw new Error(`inputAt(…) needs an input, and "${input}" isn't one`);
    const base = compile(parsed(variable.base), (name) => () => parameter(name))({});
    return base * multiplierAt(settings.inputs[input], year);
  };
}

const PARSED = new Map<string, Node>();
