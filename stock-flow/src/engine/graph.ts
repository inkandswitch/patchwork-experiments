import { names } from "./expr.ts";
import { createEvaluator, dependencies, parsed, type Evaluator } from "./simulate.ts";
import type { LinkKey, LoopId, ParameterId, Run, Settings, StockFlowModelDoc, VariableId } from "../types.ts";

export type Polarity = "+" | "−" | "±" | "0";

export type GraphLink = {
  from: VariableId;
  to: VariableId;
  /** Sign of the effect along the run: ± when it changes, 0 when the link never acts. */
  polarity: Polarity;
  /** Delay parameters in the equations the link passes through. */
  delays: ParameterId[];
  /** The equation links folded into this one. */
  via: LinkKey[];
};

export type GraphLoop = {
  variables: VariableId[];
  links: LinkKey[];
  polarity: "reinforcing" | "balancing" | "mixed" | "inactive";
  /** Named loops this cycle belongs to: it passes through one of their cut links. */
  named: LoopId[];
};

export type CausalGraph = { nodes: VariableId[]; links: GraphLink[]; loops: GraphLoop[] };

export type GraphOptions = {
  /** Every variable is a node. */
  all?: boolean;
  /** Exactly these variables are nodes; links fold in the rest, stocks included. */
  visible?: VariableId[];
};

/**
 * The feedback structure of a model, read from its equations. With `all`, every variable is a node; otherwise only
 * key variables are, and the links between them fold in the variables in between.
 */
export function causalGraph(model: StockFlowModelDoc, run: Run, settings: Settings, options: GraphOptions = {}): CausalGraph {
  const ids = Object.keys(model.variables);
  if (options.visible) {
    const visible = new Set(options.visible);
    const stocks = ids.filter((id) => model.variables[id].kind === "stock");
    const links = keyLinks(model, run, settings, new Set([...visible, ...stocks]));
    const nodes = ids.filter((id) => visible.has(id));
    const folded = foldStocks(links, stocks.filter((id) => !visible.has(id)));
    return { nodes, links: folded, loops: findLoops(model, nodes, folded) };
  }
  const flagged = ids.filter((id) => model.variables[id].key);
  const keys = new Set(options.all || !flagged.length ? ids : flagged);
  const links = keyLinks(model, run, settings, keys);
  const nodes = ids.filter((id) => keys.has(id));
  return { nodes, links, loops: findLoops(model, nodes, links) };
}

/** Links between the key variables, folding in the other flows and auxiliaries. Stocks are never folded here. */
function keyLinks(model: StockFlowModelDoc, run: Run, settings: Settings, keys: Set<VariableId>): GraphLink[] {
  const ids = Object.keys(model.variables);
  const dependents = dependentsOf(model);
  const readers = new Map(ids.map((id) => [id, dependencies(model, id)]));
  const hidden = (id: VariableId) => !keys.has(id) && model.variables[id].kind !== "stock";

  const evaluator = createEvaluator(model, settings);
  const samples = sampleScopes(evaluator, run);
  const links: GraphLink[] = [];
  for (const from of keys) {
    const downstream = reach(from, (id) => dependents.get(id) ?? [], hidden);
    for (const to of new Set([...downstream.ends].filter((id) => keys.has(id) && id !== from))) {
      const upstream = reach(to, (id) => readers.get(id) ?? [], hidden);
      const between = [...downstream.inner].filter((id) => upstream.inner.has(id));
      const path = new Set([from, ...between, to]);
      const via = [...path].filter((node) => node !== from).flatMap((node) =>
        (readers.get(node) ?? []).filter((source) => source !== to && path.has(source)).map((source) => `${source}→${node}`),
      );
      links.push({
        from,
        to,
        polarity: polarity(model, evaluator, samples, from, to, between),
        delays: delaysOn(model, [...between, ...(model.variables[to].kind === "stock" ? [] : [to])]),
        via,
      });
    }
  }
  return links;
}

/**
 * Removes stocks from the diagram by joining each link into a stock with each link out of it. The sign of a chain is
 * the product of its signs; chains that join the same two variables merge, and loops through a stock alone vanish.
 */
function foldStocks(links: GraphLink[], hidden: VariableId[]): GraphLink[] {
  let current = links;
  for (const stock of hidden) {
    const into = current.filter((link) => link.to === stock && link.from !== stock);
    const out = current.filter((link) => link.from === stock && link.to !== stock);
    const rest = new Map(current.filter((link) => link.from !== stock && link.to !== stock).map((link) => [`${link.from}→${link.to}`, link]));
    for (const first of into) {
      for (const second of out) {
        if (first.from === second.to) continue;
        const chain: GraphLink = {
          from: first.from,
          to: second.to,
          polarity: chainPolarity(first.polarity, second.polarity),
          delays: [...new Set([...first.delays, ...second.delays])],
          via: [...new Set([...first.via, ...second.via])],
        };
        const key = `${chain.from}→${chain.to}`;
        const existing = rest.get(key);
        rest.set(key, existing ? mergeLinks(existing, chain) : chain);
      }
    }
    current = [...rest.values()];
  }
  return current;
}

function chainPolarity(a: Polarity, b: Polarity): Polarity {
  if (a === "0" || b === "0") return "0";
  if (a === "±" || b === "±") return "±";
  return a === b ? "+" : "−";
}

function mergeLinks(a: GraphLink, b: GraphLink): GraphLink {
  const polarity = a.polarity === "0" ? b.polarity : b.polarity === "0" || a.polarity === b.polarity ? a.polarity : "±";
  return { ...a, polarity, delays: [...new Set([...a.delays, ...b.delays])], via: [...new Set([...a.via, ...b.via])] };
}

/** Every link written in an equation or a stock's flows, as "from→to". */
export function equationLinks(model: StockFlowModelDoc): LinkKey[] {
  return Object.keys(model.variables).flatMap((to) => dependencies(model, to).map((from) => `${from}→${to}`));
}

function dependentsOf(model: StockFlowModelDoc): Map<VariableId, VariableId[]> {
  const dependents = new Map<VariableId, VariableId[]>();
  for (const to of Object.keys(model.variables)) {
    for (const from of dependencies(model, to)) dependents.set(from, [...(dependents.get(from) ?? []), to]);
  }
  return dependents;
}

/** Walks from a node through hidden variables: `inner` are the hidden ones passed, `ends` the first visible ones. */
function reach(start: VariableId, next: (id: VariableId) => VariableId[], hidden: (id: VariableId) => boolean) {
  const inner = new Set<VariableId>();
  const ends = new Set<VariableId>();
  const queue = [start];
  while (queue.length) {
    for (const id of next(queue.shift()!)) {
      if (hidden(id)) {
        if (!inner.has(id)) {
          inner.add(id);
          queue.push(id);
        }
      } else ends.add(id);
    }
  }
  return { inner, ends };
}

type Sample = Record<string, number>;

function sampleScopes(evaluator: Evaluator, run: Run): Sample[] {
  const every = Math.max(1, Math.floor(run.years.length / 80));
  const samples: Sample[] = [];
  for (let index = 0; index < run.years.length; index += every) {
    const scope = evaluator.initialScope();
    scope.time = run.years[index] - run.years[0];
    for (const stock of evaluator.stocks) scope[stock] = run.values[stock][index];
    evaluator.evaluate(scope);
    samples.push(scope);
  }
  return samples;
}

/** Central differences at each sample: nudge `from`, recompute what lies between, and read `to` (a stock: its net flow). */
function polarity(
  model: StockFlowModelDoc,
  evaluator: Evaluator,
  samples: Sample[],
  from: VariableId,
  to: VariableId,
  between: VariableId[],
): Polarity {
  const toIsStock = model.variables[to].kind === "stock";
  const recompute = evaluator.order.filter((id) => between.includes(id) || (!toIsStock && id === to));
  const effect = (sample: Sample, value: number) => {
    const scope = { ...sample, [from]: value };
    for (const id of recompute) scope[id] = evaluator.evaluateOne(id, scope);
    return toIsStock ? evaluator.netFlow(to, scope) : scope[to];
  };
  let up = false;
  let down = false;
  for (const sample of samples) {
    const value = sample[from];
    const step = Math.abs(value) * 1e-6 || 1e-6;
    const high = effect(sample, value + step);
    const low = effect(sample, value - step);
    const change = high - low;
    if (!Number.isFinite(change) || Math.abs(change) <= 1e-9 * (Math.abs(high) + Math.abs(low))) continue;
    if (change > 0) up = true;
    else down = true;
  }
  return up && down ? "±" : up ? "+" : down ? "−" : "0";
}

function delaysOn(model: StockFlowModelDoc, variables: VariableId[]): ParameterId[] {
  const delays = new Set<ParameterId>();
  for (const id of variables) {
    const variable = model.variables[id];
    if (variable.kind !== "flow" && variable.kind !== "auxiliary") continue;
    for (const name of names(parsed(variable.equation))) if (model.parameters[name]?.delay) delays.add(name);
  }
  return [...delays];
}

function findLoops(model: StockFlowModelDoc, nodes: VariableId[], links: GraphLink[]): GraphLoop[] {
  const byKey = new Map(links.map((link) => [`${link.from}→${link.to}`, link]));
  const cycles = elementaryCycles(nodes, links);
  return cycles.map((variables) => {
    const keys = variables.map((id, index) => `${id}→${variables[(index + 1) % variables.length]}`);
    const cycleLinks = keys.map((key) => byKey.get(key)!);
    const via = new Set(cycleLinks.flatMap((link) => link.via));
    const named = Object.entries(model.annotations.loops)
      .filter(([, loop]) => loop.cut.some((cut) => via.has(cut.replace("->", "→"))))
      .map(([id]) => id);
    return { variables, links: keys, polarity: loopPolarity(cycleLinks.map((link) => link.polarity)), named };
  });
}

function loopPolarity(polarities: Polarity[]): GraphLoop["polarity"] {
  if (polarities.includes("0")) return "inactive";
  if (polarities.includes("±")) return "mixed";
  return polarities.filter((sign) => sign === "−").length % 2 ? "balancing" : "reinforcing";
}

/** Johnson's algorithm, each cycle starting at its first node in `nodes` order. Stops at MAX_CYCLES. */
function elementaryCycles(nodes: VariableId[], links: GraphLink[]): VariableId[][] {
  const index = new Map(nodes.map((id, i) => [id, i]));
  const successors = nodes.map(() => [] as number[]);
  for (const link of links) successors[index.get(link.from)!].push(index.get(link.to)!);
  const cycles: VariableId[][] = [];
  for (let start = 0; start < nodes.length && cycles.length < MAX_CYCLES; start++) {
    const blocked = new Set<number>();
    const blockMap = new Map<number, Set<number>>();
    const stack: number[] = [];
    const unblock = (node: number) => {
      blocked.delete(node);
      for (const other of blockMap.get(node) ?? []) if (blocked.has(other)) unblock(other);
      blockMap.delete(node);
    };
    const circuit = (node: number): boolean => {
      let found = false;
      stack.push(node);
      blocked.add(node);
      for (const next of successors[node]) {
        if (next < start || cycles.length >= MAX_CYCLES) continue;
        if (next === start) {
          cycles.push(stack.map((i) => nodes[i]));
          found = true;
        } else if (!blocked.has(next) && circuit(next)) found = true;
      }
      if (found) unblock(node);
      else
        for (const next of successors[node]) {
          if (next < start) continue;
          if (!blockMap.has(next)) blockMap.set(next, new Set());
          blockMap.get(next)!.add(node);
        }
      stack.pop();
      return found;
    };
    circuit(start);
  }
  return cycles.sort((a, b) => a.length - b.length);
}

const MAX_CYCLES = 2000;
