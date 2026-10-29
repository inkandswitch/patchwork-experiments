import { chartSpec } from "../src/charts/resolve.ts";
import type { StockFlowChartDoc, StockFlowModelDoc } from "../src/types.ts";

export type ChartFields = Omit<StockFlowChartDoc, "@patchwork" | "model">;

/** A fenced block in markdown that becomes an embedded document. */
export type Block = { kind: "chart"; fields: ChartFields } | { kind: "scenario"; scenarios: string[] };

/**
 * Replaces each ```chart and ```scenario fence with what `embed` returns for it, after checking the chart runs.
 * `embed` creates the document and returns its [patchwork:…] embed.
 */
export async function convertFences(
  markdown: string,
  model: StockFlowModelDoc,
  embed: (block: Block) => Promise<string>,
): Promise<string> {
  const pattern = /```(chart|scenario)[^\S\n]*\n([\s\S]*?)```/g;
  let result = "";
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    result += markdown.slice(last, match.index);
    last = match.index! + match[0].length;
    const [, kind, source] = match;
    if (kind === "chart") {
      const fields = parseChart(source);
      chartSpec(model, fields);
      result += await embed({ kind: "chart", fields });
    } else {
      const scenarios = source
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const id of scenarios) if (!(id in model.scenarios)) throw new Error(`Unknown scenario "${id}" in a scenario block`);
      result += await embed({ kind: "scenario", scenarios });
    }
  }
  return result + markdown.slice(last);
}

/** The `key: value` lines of a chart fence: title, scenarios, series, data, sweep, years, guide. */
export function parseChart(source: string): ChartFields {
  const fields = new Map<string, string>();
  for (const line of source.split("\n")) {
    const match = /^\s*([a-z]+)\s*:\s*(.*)$/.exec(line);
    if (match) fields.set(match[1], match[2].trim());
    else if (line.trim()) throw new Error(`Can't read the chart line "${line.trim()}"; write key: value`);
  }
  const list = (name: string) =>
    (fields.get(name) ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  return {
    title: fields.get("title") ?? "",
    scenarios: list("scenarios"),
    series: list("series"),
    data: list("data"),
    ...(fields.has("sweep") ? { sweep: parseSweep(fields.get("sweep")!) } : {}),
    ...(fields.has("years") ? { years: parseYears(fields.get("years")!) } : {}),
    ...(fields.has("guide") ? { guide: parseGuide(fields.get("guide")!) } : {}),
  };
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
