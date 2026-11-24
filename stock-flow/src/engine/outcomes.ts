import { valueAt } from "./fit.ts";
import type { Outcome, Run, StockFlowModelDoc } from "../types.ts";

/** Reads an outcome off a run, in the units charts show. */
export function measure(model: StockFlowModelDoc, run: Run, outcome: Outcome): number {
  const scale = model.variables[outcome.variable]?.scale ?? 1;
  const at = (year: number) => valueAt(run, outcome.variable, year) * scale;
  switch (outcome.kind) {
    case "value":
      return at(outcome.year);
    case "peak": {
      const [from, to] = outcome.years ?? [run.years[0], run.years[run.years.length - 1]];
      const values = run.years.flatMap((year, index) => (year >= from && year <= to ? [run.values[outcome.variable][index] * scale] : []));
      return values.length ? Math.max(...values) : NaN;
    }
    case "crossing": {
      const after = outcome.after ?? run.years[0];
      let previous: number | undefined;
      for (let index = 0; index < run.years.length; index++) {
        const year = run.years[index];
        if (year < after) continue;
        const value = run.values[outcome.variable][index] * scale;
        if (previous !== undefined && (previous - outcome.level) * (value - outcome.level) <= 0 && previous !== value) {
          const before = run.years[index - 1];
          return before + ((outcome.level - previous) / (value - previous)) * (year - before);
        }
        previous = value;
      }
      return NaN;
    }
    case "change": {
      const [from, to] = [at(outcome.from), at(outcome.to)];
      return outcome.relative ? to / from - 1 : to - from;
    }
  }
}

export function outcomeLabel(model: StockFlowModelDoc, outcome: Outcome): string {
  const label = model.variables[outcome.variable]?.label ?? outcome.variable;
  switch (outcome.kind) {
    case "value":
      return `${label} in ${outcome.year}`;
    case "peak":
      return `Peak ${label.toLowerCase()}${outcome.years ? ` ${outcome.years[0]}–${outcome.years[1]}` : ""}`;
    case "crossing":
      return `Year ${label.toLowerCase()} crosses ${outcome.level}${outcome.after ? ` after ${outcome.after}` : ""}`;
    case "change":
      return `${outcome.relative ? "Relative change" : "Change"} in ${label.toLowerCase()} ${outcome.from}–${outcome.to}`;
  }
}

/** Formats an outcome value: years for crossings, percent for relative changes, else the variable's unit. */
export function outcomeFormatter(model: StockFlowModelDoc, outcome: Outcome, unitFormatter: (unit: string) => (value: number) => string): (value: number) => string {
  if (outcome.kind === "crossing") return (value) => (Number.isNaN(value) ? "never" : value.toFixed(1));
  if (outcome.kind === "change" && outcome.relative) return (value) => `${(value * 100).toFixed(1)}%`;
  return unitFormatter(model.variables[outcome.variable]?.unit ?? "");
}

/**
 * Outcome syntax: "rent@2024" or "rent in 2024"; "peak rent 2020–2040"; "vacancy crosses 3 after 2025";
 * "change rent 2010–2024 relative".
 */
export function parseOutcome(text: string): Outcome {
  const source = text.trim();
  let match: RegExpExecArray | null;
  if ((match = /^(\w+)\s*(?:@|\s+in\s+)\s*(\d{4})$/.exec(source))) return { kind: "value", variable: match[1], year: Number(match[2]) };
  if ((match = /^peak\s+(\w+)(?:\s+(\d{4})\s*[–-]\s*(\d{4}))?$/.exec(source))) {
    return { kind: "peak", variable: match[1], ...(match[2] ? { years: [Number(match[2]), Number(match[3])] as [number, number] } : {}) };
  }
  if ((match = /^(\w+)\s+crosses\s+(-?[\d.]+)(?:\s+after\s+(\d{4}))?$/.exec(source))) {
    return { kind: "crossing", variable: match[1], level: Number(match[2]), ...(match[3] ? { after: Number(match[3]) } : {}) };
  }
  if ((match = /^change\s+(\w+)\s+(\d{4})\s*[–-]\s*(\d{4})(\s+relative)?$/.exec(source))) {
    return { kind: "change", variable: match[1], from: Number(match[2]), to: Number(match[3]), ...(match[4] ? { relative: true } : {}) };
  }
  throw new Error(`Can't read the outcome "${source}"; write rent@2024, peak rent 2020–2040, vacancy crosses 3 after 2025, or change rent 2010–2024 relative`);
}

export function checkOutcome(model: StockFlowModelDoc, outcome: Outcome): void {
  if (!(outcome.variable in model.variables)) throw new Error(`Unknown variable "${outcome.variable}" in an outcome`);
}
