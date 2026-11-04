import { chartSpec } from "../src/charts/resolve.ts";
import { attribute, type AttributionFields } from "../src/engine/attribution.ts";
import { parseOutcome } from "../src/engine/outcomes.ts";
import { runSensitivity, type SensitivityFields } from "../src/engine/sensitivity.ts";
import { checkTests, type TestFields } from "../src/engine/tests.ts";
import type { Expectation, FitIndex, FitStats, StockFlowChartDoc, StockFlowModelDoc, TestSpec } from "../src/types.ts";

export type ChartFields = Omit<StockFlowChartDoc, "@patchwork" | "model">;

/** A fenced block in markdown that becomes an embedded document. */
export type Block =
  | { kind: "chart"; fields: ChartFields }
  | { kind: "scenario"; scenarios: string[] }
  | { kind: "tests"; fields: TestFields }
  | { kind: "sensitivity"; fields: SensitivityFields }
  | { kind: "attribution"; fields: AttributionFields };

const FENCES = ["chart", "scenario", "tests", "sensitivity", "attribution"] as const;

/**
 * Replaces each ```chart, ```scenario, ```tests, ```sensitivity and ```attribution fence with what `embed` returns
 * for it, after checking the block runs. `embed` creates the document and returns its [patchwork:…] embed.
 */
export async function convertFences(markdown: string, model: StockFlowModelDoc, embed: (block: Block) => Promise<string>): Promise<string> {
  const pattern = new RegExp("```(" + FENCES.join("|") + ")[^\\S\\n]*\\n([\\s\\S]*?)```", "g");
  let result = "";
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    result += markdown.slice(last, match.index);
    last = match.index! + match[0].length;
    const [, kind, source] = match;
    result += await embed(parseBlock(kind as (typeof FENCES)[number], source, model));
  }
  return result + markdown.slice(last);
}

export function hasFences(markdown: string): boolean {
  return new RegExp("```(" + FENCES.join("|") + ")").test(markdown);
}

/** Parses one fence body and runs it once against the model, so a notebook can't embed a block that fails. */
export function parseBlock(kind: (typeof FENCES)[number], source: string, model: StockFlowModelDoc): Block {
  switch (kind) {
    case "chart": {
      const fields = parseChart(source);
      chartSpec(model, fields);
      return { kind, fields };
    }
    case "scenario": {
      const scenarios = source
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const id of scenarios) if (!(id in model.scenarios)) throw new Error(`Unknown scenario "${id}" in a scenario block`);
      return { kind, scenarios };
    }
    case "tests": {
      const fields = parseTests(source);
      checkTests(model, fields);
      return { kind, fields };
    }
    case "sensitivity": {
      const fields = parseSensitivity(source);
      runSensitivity(model, fields);
      return { kind, fields };
    }
    case "attribution": {
      const fields = parseAttribution(source);
      attribute(model, fields);
      return { kind, fields };
    }
  }
}

/** The `key: value` lines of a chart fence: title, scenarios, series, data, sweep, years, guide, fit. */
export function parseChart(source: string): ChartFields {
  const { fields } = keyValues(source, "chart");
  const list = (name: string) => commaList(fields.get(name));
  return {
    title: fields.get("title") ?? "",
    scenarios: list("scenarios"),
    series: list("series"),
    data: list("data"),
    ...(fields.has("sweep") ? { sweep: parseSweep(fields.get("sweep")!) } : {}),
    ...(fields.has("years") ? { years: parseYears(fields.get("years")!) } : {}),
    ...(fields.has("guide") ? { guide: parseGuide(fields.get("guide")!) } : {}),
    ...(fields.has("fit") ? { fit: parseFit(fields.get("fit")!) } : {}),
  };
}

/**
 * A `scenario:` line, then one test per line:
 *   structure | equilibrium [tolerance] | integration [tolerance]
 *   extreme "label" [set k=v,…] [inputs k=v,…] [from YEAR] expect var check [value], …   checks: min max between finite settles
 *   knockout <loop | k=v,…> <variable> [minEffect]                             k=v sets switches for a channel that is not a loop
 *   inert <k=v,…> <variable,…> [inputs k=v,…] [maxEffect]                      the switch moves none of them by more than maxEffect
 *   fit <data> [from–to] [index <year>|mean] [lead a–b] [stat limit]…          stats: rmse mape r2 theilU bias variation covariation
 *   holdout <data> fit from–to test from–to [index <year>|mean] [lead a–b] [stat limit]…
 */
export function parseTests(source: string): TestFields {
  const { fields, lines } = keyValues(source, "tests", ["scenario"]);
  const scenario = fields.get("scenario");
  if (!scenario) throw new Error("A tests block needs a scenario: line");
  if (!lines.length) throw new Error("A tests block needs at least one test line");
  return { scenario, tests: lines.map(parseTestLine) };
}

export function parseTestLine(line: string): TestSpec {
  const [kind, ...rest] = line.trim().split(/\s+/);
  const tail = rest.join(" ");
  switch (kind) {
    case "structure":
      return { kind };
    case "equilibrium":
    case "integration":
      return { kind, ...(tail ? { tolerance: number(tail, line) } : {}) };
    case "extreme": {
      const match = /^"([^"]+)"\s*(.*)$/.exec(tail);
      if (!match) throw new Error(`Write an extreme test as: extreme "label" [set k=v] [inputs k=v] [from YEAR] expect var check value — not "${line}"`);
      const [, label, body] = match;
      const clauses = /^(?:set\s+(\S+))?\s*(?:inputs\s+(\S+))?\s*(?:from\s+(\d{4}))?\s*expect\s+(.+)$/.exec(body);
      if (!clauses) throw new Error(`An extreme test needs an expect clause: "${line}"`);
      const [, set, inputs, from, expectations] = clauses;
      return {
        kind,
        label,
        ...(set ? { set: assignments(set, line) } : {}),
        ...(inputs ? { inputs: assignments(inputs, line) } : {}),
        ...(from ? { from: Number(from) } : {}),
        expect: expectations.split(",").map((text) => parseExpectation(text, line)),
      };
    }
    case "inert": {
      const match = /^(\S+)\s+(\S+)(?:\s+inputs\s+(\S+))?(?:\s+(\S+))?$/.exec(tail);
      if (!match || !match[1].includes("=")) throw new Error(`Write an inert test as: inert <k=v,…> <variable,…> [inputs k=v,…] [maxEffect] — not "${line}"`);
      const [, set, variables, inputs, maxEffect] = match;
      return {
        kind,
        set: assignments(set, line),
        ...(inputs ? { inputs: assignments(inputs, line) } : {}),
        variables: variables.split(","),
        maxEffect: maxEffect ? number(maxEffect, line) : 0.001,
      };
    }
    case "knockout": {
      const [loop, variable, minEffect] = rest;
      if (!loop || !variable) throw new Error(`Write a knockout test as: knockout <loop | k=v,…> <variable> [minEffect] — not "${line}"`);
      const cut = loop.includes("=") ? { set: assignments(loop, line) } : { loop };
      return { kind, ...cut, variable, minEffect: minEffect ? number(minEffect, line) : 0.05 };
    }
    case "fit": {
      const [data, ...options] = rest;
      if (!data) throw new Error(`Write a fit test as: fit <data> [from–to] [index <year>|mean] [lead a–b] [stat limit]… — not "${line}"`);
      const years = options[0] && /^\d{4}\s*[–-]\s*\d{4}$/.test(options[0]) ? parseYears(options.shift()!) : undefined;
      return { kind, data, ...(years ? { years } : {}), ...fitIndex(options, line), ...fitLead(options, line), ...limits(options, line) };
    }
    case "holdout": {
      const match = /^(\S+)\s+fit\s+(\d{4}\s*[–-]\s*\d{4})\s+test\s+(\d{4}\s*[–-]\s*\d{4})\s*(.*)$/.exec(tail);
      if (!match) throw new Error(`Write a holdout test as: holdout <data> fit from–to test from–to [index <year>|mean] [lead a–b] [stat limit]… — not "${line}"`);
      const [, data, fitYears, testYears, rest] = match;
      const options = rest.split(/\s+/).filter(Boolean);
      return { kind, data, fitYears: parseYears(fitYears), testYears: parseYears(testYears), ...fitIndex(options, line), ...fitLead(options, line), ...limits(options, line) };
    }
    default:
      throw new Error(`Unknown test "${kind}" in "${line}"; use structure, equilibrium, integration, extreme, knockout, fit or holdout`);
  }
}

function parseExpectation(text: string, line: string): Expectation {
  const [variable, check, ...values] = text.trim().split(/\s+/);
  if (!variable || !check) throw new Error(`Write an expectation as: variable check [value] — not "${text}" in "${line}"`);
  switch (check) {
    case "finite":
      return { variable, check };
    case "min":
    case "max":
    case "settles":
      if (values.length !== 1) throw new Error(`"${check}" takes one value: "${text}"`);
      return { variable, check, value: number(values[0], line) };
    case "between":
      if (values.length !== 2) throw new Error(`"between" takes two values: "${text}"`);
      return { variable, check, value: [number(values[0], line), number(values[1], line)] };
    default:
      throw new Error(`Unknown check "${check}" in "${text}"; use min, max, between, finite or settles`);
  }
}

/** Takes a leading `index <year>` or `index mean` off the options. */
function fitIndex(options: string[], line: string): { index?: FitIndex } {
  if (options[0] !== "index") return {};
  const [, value] = options.splice(0, 2);
  if (value === "mean") return { index: "mean" };
  if (!value || !/^\d{4}$/.test(value)) throw new Error(`"index" takes a year or "mean": "${line}"`);
  return { index: Number(value) };
}

/** Takes a leading `lead a–b` (whole years, data ahead of the model) off the options. */
function fitLead(options: string[], line: string): { lead?: [number, number] } {
  if (options[0] !== "lead") return {};
  const [, value] = options.splice(0, 2);
  const match = value && /^(\d+)(?:\s*[–-]\s*(\d+))?$/.exec(value);
  if (!match) throw new Error(`"lead" takes whole years, one or a range like 0–1: "${line}"`);
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (to < from) throw new Error(`"lead" range runs backwards: "${line}"`);
  return { lead: [from, to] };
}

const STATS: (keyof FitStats)[] = ["rmse", "mape", "r2", "theilU", "bias", "variation", "covariation"];

function limits(options: string[], line: string): { max?: Partial<FitStats> } {
  if (!options.length) return {};
  if (options.length % 2) throw new Error(`Limits come in pairs, stat then number: "${line}"`);
  const max: Partial<FitStats> = {};
  for (let index = 0; index < options.length; index += 2) {
    const stat = options[index] as keyof FitStats;
    if (!STATS.includes(stat)) throw new Error(`Unknown statistic "${stat}" in "${line}"; use ${STATS.join(", ")}`);
    max[stat] = number(options[index + 1], line);
  }
  return { max };
}

/**
 * Lines: scenario, parameters (name, name from–to, name ±30%), spread (default, e.g. 50%), method (one-at-a-time, or
 * latin-hypercube <samples> [seed <n>]), outcomes (comma-separated), ranking (<scenario>, <scenario> by <outcome index> lower|higher).
 */
export function parseSensitivity(source: string): SensitivityFields {
  const { fields } = keyValues(source, "sensitivity");
  const scenario = fields.get("scenario");
  if (!scenario) throw new Error("A sensitivity block needs a scenario: line");
  const spread = fields.has("spread") ? percentOrShare(fields.get("spread")!) : 0.5;
  const parameters = parseParameterRanges(fields.get("parameters"), spread);
  if (!Object.keys(parameters).length) throw new Error("A sensitivity block needs a parameters: line");
  const methodText = fields.get("method") ?? "one-at-a-time";
  const hypercube = /^latin-hypercube\s+(\d+)(?:\s+seed\s+(\d+))?$/.exec(methodText);
  const method: SensitivityFields["method"] = hypercube
    ? { kind: "latin-hypercube", samples: Number(hypercube[1]), seed: hypercube[2] ? Number(hypercube[2]) : 1 }
    : methodText === "one-at-a-time"
      ? { kind: "one-at-a-time" }
      : (() => {
          throw new Error(`Unknown method "${methodText}"; use one-at-a-time or latin-hypercube <samples> [seed <n>]`);
        })();
  const outcomes = commaList(fields.get("outcomes")).map(parseOutcome);
  if (!outcomes.length) throw new Error("A sensitivity block needs an outcomes: line");
  const ranking = fields.has("ranking") ? parseRanking(fields.get("ranking")!) : undefined;
  return { scenario, parameters, method, outcomes, ...(ranking ? { ranking } : {}) };
}

/** "landYears 5–30, rentSensitivity ±50%, householdRentElasticity" — bare names take the default spread. */
function parseParameterRanges(text: string | undefined, spread: number): SensitivityFields["parameters"] {
  return Object.fromEntries(
    commaList(text).map((entry) => {
      const match = /^(\w+)(?:\s+(?:(-?[\d.]+)\s*[–-]\s*(-?[\d.]+)|±\s*([\d.]+)%?))?$/.exec(entry);
      if (!match) throw new Error(`Write a parameter as name, name 5–30 or name ±50%, not "${entry}"`);
      const [, id, min, max, plusMinus] = match;
      if (min !== undefined) return [id, { min: Number(min), max: Number(max) }];
      return [id, { spread: plusMinus !== undefined ? Number(plusMinus) / 100 : spread }];
    }),
  );
}

function parseRanking(text: string): SensitivityFields["ranking"] {
  const match = /^(.+?)\s+by\s+(\d+)\s+(lower|higher)$/.exec(text.trim());
  if (!match) throw new Error(`Write a ranking as: scenario, scenario by <outcome index> lower|higher — not "${text}"`);
  return { scenarios: commaList(match[1]), outcome: Number(match[2]), lowerIsBetter: match[3] === "lower" };
}

/** Lines: scenario, outcome, drivers (label = input, input, parameter=value; label = …). */
export function parseAttribution(source: string): AttributionFields {
  const { fields } = keyValues(source, "attribution");
  const scenario = fields.get("scenario");
  if (!scenario) throw new Error("An attribution block needs a scenario: line");
  if (!fields.has("outcome")) throw new Error("An attribution block needs an outcome: line");
  const outcome = parseOutcome(fields.get("outcome")!);
  const drivers = Object.fromEntries(
    (fields.get("drivers") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((entry) => {
        const match = /^([^=]+?)\s*=\s*(.+)$/.exec(entry);
        if (!match) throw new Error(`Write a driver as label = input, input, parameter=value — not "${entry}"`);
        const [, label, items] = match;
        const inputs: string[] = [];
        const parameters: Record<string, number> = {};
        for (const item of commaList(items)) {
          const assignment = /^(\w+)\s*=\s*(-?[\d.]+)$/.exec(item);
          if (assignment) parameters[assignment[1]] = Number(assignment[2]);
          else inputs.push(item);
        }
        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return [id, { label, ...(inputs.length ? { inputs } : {}), ...(Object.keys(parameters).length ? { parameters } : {}) }];
      }),
  );
  if (!Object.keys(drivers).length) throw new Error("An attribution block needs a drivers: line");
  const uncertainty = fields.has("uncertainty") ? parseUncertainty(fields.get("uncertainty")!) : undefined;
  return { scenario, outcome, drivers, ...(uncertainty ? { uncertainty } : {}) };
}

/** "landYears 5–30, rentSensitivity ±50%; 40 samples seed 3" */
function parseUncertainty(text: string): NonNullable<AttributionFields["uncertainty"]> {
  const [ranges, rest = ""] = text.split(";").map((part) => part.trim());
  const match = /^(?:(\d+)\s+samples?)?\s*(?:seed\s+(\d+))?$/.exec(rest);
  if (!match) throw new Error(`Write uncertainty as parameter ranges; <n> samples seed <s> — not "${text}"`);
  const parameters = parseParameterRanges(ranges, 0.5);
  if (!Object.keys(parameters).length) throw new Error("An uncertainty: line needs at least one parameter");
  return { parameters, samples: Number(match[1] ?? 40), seed: Number(match[2] ?? 1) };
}

export function parseSweep(text: string): { knob: string; values: number[] } {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(text.trim());
  if (!match) throw new Error(`Write a sweep as name = value, value, not "${text}"`);
  const values = match[2].split(",").map((value) => Number(value.trim()));
  if (values.some(Number.isNaN)) throw new Error(`Sweep values must be numbers: ${match[2]}`);
  return { knob: match[1], values };
}

export function parseYears(text: string): [number, number] {
  const [from, to] = text.split(/[–-]/).map((part) => Number(part.trim()));
  if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`Write years as 2010–2040, not "${text}"`);
  return [from, to];
}

export function parseGuide(text: string): { value: number; label: string } {
  const match = /^(-?[\d.]+)\s*(.*)$/.exec(text.trim());
  if (!match) throw new Error(`Write a guide as a number and a label, not "${text}"`);
  return { value: Number(match[1]), label: match[2] };
}

export function parseFit(text: string): ChartFields["fit"] {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "yes" || trimmed === "") return true;
  if (trimmed === "false" || trimmed === "no") return false;
  return { years: parseYears(trimmed) };
}

/** `key: value` lines into a map; other non-blank lines are returned as `lines` when `bare` keys are allowed, else rejected. */
function keyValues(source: string, block: string, keysOnlyFor?: string[]): { fields: Map<string, string>; lines: string[] } {
  const fields = new Map<string, string>();
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    const match = /^\s*([a-z]+)\s*:\s*(.*)$/.exec(line);
    if (match && (!keysOnlyFor || keysOnlyFor.includes(match[1]))) fields.set(match[1], match[2].trim());
    else if (line.trim() && keysOnlyFor) lines.push(line.trim());
    else if (line.trim()) throw new Error(`Can't read the ${block} line "${line.trim()}"; write key: value`);
  }
  return { fields, lines };
}

function commaList(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function assignments(text: string, line: string): Record<string, number> {
  return Object.fromEntries(
    text.split(",").map((pair) => {
      const [key, value] = pair.split("=");
      if (!key || value === undefined) throw new Error(`Write assignments as k=v,k=v in "${line}"`);
      return [key.trim(), number(value, line)];
    }),
  );
}

function number(text: string, line: string): number {
  const value = Number(text.trim());
  if (Number.isNaN(value)) throw new Error(`"${text}" is not a number in "${line}"`);
  return value;
}

function percentOrShare(text: string): number {
  const value = Number(text.replace("%", "").replace("±", "").trim());
  if (Number.isNaN(value)) throw new Error(`Write a spread as 50% or 0.5, not "${text}"`);
  return text.includes("%") || value > 1 ? value / 100 : value;
}
