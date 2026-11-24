import { parse, type Node } from "./expr.ts";
import type { Issue } from "./check.ts";
import type { StockFlowModelDoc } from "../types.ts";

/**
 * Dimensional consistency (Sterman §21.4.3): every equation must give the unit its variable declares, flows must
 * be their stock's unit per year, and no equation may add or compare quantities in different units. Units are
 * read from the human-readable unit strings ("dwellings per year", "€ per m² per month, 2000 prices"); strings
 * that can't be read are reported and treated as unknown, which matches anything.
 */
export type Dimensions = Record<string, number>;

/** `null` means unknown: the unit string could not be read, so the check is skipped for that quantity. */
type Unit = Dimensions | null;

export function unitIssues(model: StockFlowModelDoc): Issue[] {
  const issues: Issue[] = [];
  const units = new Map<string, Unit>();
  const unreadable: string[] = [];
  const remember = (id: string, text: string | undefined, where: string) => {
    if (!text) return units.set(id, null);
    const unit = parseUnit(text);
    if (!unit) unreadable.push(`${where} "${text}"`);
    units.set(id, unit);
  };
  for (const [id, parameter] of Object.entries(model.parameters)) remember(id, parameter.unit, `parameters.${id}`);
  for (const [id, variable] of Object.entries(model.variables)) remember(id, variable.unit, `variables.${id}`);
  units.set("time", { year: 1 });
  const lookup = (name: string) => (units.has(name) ? units.get(name)! : null);
  for (const text of unreadable) issues.push({ severity: "warning", where: "units", message: `Cannot read the unit of ${text}; it is treated as unknown` });
  const missing = Object.entries(model.parameters).filter(([, p]) => !p.unit).map(([id]) => id);
  if (missing.length) issues.push({ severity: "warning", where: "units", message: `${missing.length} parameters have no unit: ${missing.join(", ")}` });

  const expect = (where: string, source: string, declared: Unit, what: string) => {
    let node: Node;
    try {
      node = parse(source);
    } catch {
      return;
    }
    const problems: string[] = [];
    const found = unitOf(node, lookup, problems);
    for (const problem of problems) issues.push({ severity: "warning", where, message: `Units: ${problem}` });
    if (found && declared && !same(found, declared)) {
      issues.push({ severity: "warning", where, message: `Units: ${what} gives ${describe(found)}, declared ${describe(declared)}` });
    }
  };

  for (const [id, parameter] of Object.entries(model.parameters)) {
    if ("derived" in parameter) expect(`parameters.${id}.derived`, parameter.derived, lookup(id), "the expression");
  }
  for (const [id, variable] of Object.entries(model.variables)) {
    const where = `variables.${id}`;
    const declared = lookup(id);
    if (variable.kind === "stock") {
      expect(`${where}.initial`, variable.initial, declared, "the initial value");
      if (declared) {
        const perYear = { ...declared, year: (declared.year ?? 0) - 1 };
        for (const flow of [...variable.inflows, ...variable.outflows]) {
          const unit = lookup(flow);
          if (unit && !same(unit, perYear)) {
            issues.push({ severity: "warning", where, message: `Units: flow "${flow}" is ${describe(unit)}, but the stock needs ${describe(perYear)}` });
          }
        }
      }
    } else if (variable.kind === "input") expect(`${where}.base`, variable.base, declared, "the base");
    else expect(`${where}.equation`, variable.equation, declared, "the equation");
  }
  return issues;
}

/** Units of an expression; `null` when it depends on something unknown. Problems found on the way are appended. */
export function unitOf(node: Node, lookup: (name: string) => Unit, problems: string[]): Unit {
  const visit = (n: Node): Dimensions | typeof ANY => {
    switch (n.type) {
      case "number":
        return n.value === 0 ? ANY : {};
      case "name":
        return lookup(n.name) ?? ANY;
      case "unary":
        return visit(n.operand);
      case "binary": {
        const left = visit(n.left);
        const right = visit(n.right);
        if (n.op === "+" || n.op === "-") return join([left, right], `${n.op === "+" ? "adding" : "subtracting"} ${describe(left)} and ${describe(right)}`);
        if (n.op === "*") return left === ANY || right === ANY ? ANY : multiply(left, right, 1);
        if (n.op === "/") return left === ANY || right === ANY ? ANY : multiply(left, right, -1);
        // ^
        if (right !== ANY && Object.keys(right).length) problems.push(`the exponent ${describe(right)} is not dimensionless`);
        if (left === ANY || !Object.keys(left).length) return left;
        if (n.right.type === "number") return power(left, n.right.value);
        problems.push(`raising ${describe(left)} to a power that is not a constant`);
        return ANY;
      }
      case "call": {
        if (n.name === "inputAt") return n.args[0]?.type === "name" ? (lookup(n.args[0].name) ?? ANY) : ANY;
        const args = n.args.map(visit);
        if (["min", "max", "clamp", "abs"].includes(n.name)) return join(args, `${n.name}() of ${args.map(describe).join(", ")}`);
        for (const arg of args) if (arg !== ANY && Object.keys(arg).length) problems.push(`${n.name}() needs a dimensionless argument, got ${describe(arg)}`);
        return {};
      }
    }
  };
  const join = (units: (Dimensions | typeof ANY)[], what: string): Dimensions | typeof ANY => {
    const known = units.filter((u): u is Dimensions => u !== ANY);
    if (!known.length) return ANY;
    if (known.some((u) => !same(u, known[0]))) problems.push(what);
    return known[0];
  };
  const result = visit(node);
  return result === ANY ? null : result;
}

const ANY = Symbol("any unit");

/** "dwellings per year" → {dwellings: 1, year: -1}; "% of dwellings" → {}; unreadable → null. */
export function parseUnit(text: string): Unit {
  const lower = text.toLowerCase().trim();
  if (!lower || /=/.test(lower)) return {};
  const parts = lower.replace(/^per\s+/, "1 per ").split(",")[0].split(/\s+per\s+/);
  const result: Dimensions = {};
  for (const [index, part] of parts.entries()) {
    const base = index === 0 && isDimensionless(part) ? "" : baseOf(part);
    if (base === undefined) return null;
    if (base) result[base] = (result[base] ?? 0) + (index === 0 ? 1 : -1);
  }
  return normalise(result);
}

/** "% of dwellings", "share", "pressure index", "0 = balanced" */
function isDimensionless(phrase: string): boolean {
  return phrase.startsWith("%") || phrase.split(/[\s()]+/).some((word) => DIMENSIONLESS_WORDS.has(word));
}

/** The base unit named by a phrase like "dwellings’ worth of land" or "students arriving"; "" for a bare qualifier. */
function baseOf(phrase: string): string | undefined {
  const words = phrase.replace(/[’']s?/g, "").split(/[\s()]+/).filter((word) => word && !FILLER.has(word));
  const bases = words.map((word) => ALIASES[word]).filter((base): base is string => base !== undefined);
  if (!bases.length) return words.length ? undefined : "";
  return bases[0];
}

const DIMENSIONLESS_WORDS = new Set(["share", "index", "ratio", "relative", "fraction", "dimensionless", "where", "multiplier", "elasticity", "factor"]);

const FILLER = new Set(["1", "of", "the", "a", "an", "for", "arriving", "worth", "land", "in", "prices", "price", "empty", "normal", "start"]);

const ALIASES: Record<string, string> = {
  dwelling: "dwellings",
  dwellings: "dwellings",
  flat: "dwellings",
  flats: "dwellings",
  household: "households",
  households: "households",
  student: "students",
  students: "students",
  person: "people",
  people: "people",
  resident: "people",
  residents: "people",
  year: "year",
  years: "year",
  month: "month",
  months: "month",
  day: "day",
  days: "day",
  "€": "€",
  eur: "€",
  euro: "€",
  euros: "€",
  "m²": "m²",
  m2: "m²",
  sqm: "m²",
  hectare: "ha",
  hectares: "ha",
  ha: "ha",
};

function multiply(a: Dimensions, b: Dimensions, sign: 1 | -1): Dimensions {
  const result = { ...a };
  for (const [base, exponent] of Object.entries(b)) result[base] = (result[base] ?? 0) + sign * exponent;
  return normalise(result);
}

function power(a: Dimensions, exponent: number): Dimensions {
  return normalise(Object.fromEntries(Object.entries(a).map(([base, e]) => [base, e * exponent])));
}

function normalise(dimensions: Dimensions): Dimensions {
  return Object.fromEntries(Object.entries(dimensions).filter(([, exponent]) => exponent !== 0));
}

function same(a: Dimensions, b: Dimensions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

export function describe(unit: Unit | typeof ANY): string {
  if (unit === ANY || unit === null) return "an unknown unit";
  const entries = Object.entries(unit);
  if (!entries.length) return "dimensionless";
  const top = entries.filter(([, e]) => e > 0).map(([base, e]) => (e === 1 ? base : `${base}^${e}`));
  const bottom = entries.filter(([, e]) => e < 0).map(([base, e]) => (e === -1 ? base : `${base}^${-e}`));
  return `${top.join("·") || "1"}${bottom.length ? ` per ${bottom.join(" per ")}` : ""}`;
}
