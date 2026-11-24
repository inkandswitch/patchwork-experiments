import { formatter } from "../charts/resolve.ts";
import type { Parameter, StockFlowModelDoc, VariableId } from "../types.ts";

export function formatParameter(value: number, format: Parameter["format"]): string {
  if (format === "percent") return `${trim(value * 100, 1)}%`;
  if (format === "currency") return `€${value.toFixed(2)}`;
  if (format === "years") return `${trim(value, 2)} years`;
  return Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("en") : trim(value, 3);
}

export function formatVariable(model: StockFlowModelDoc, id: VariableId, value: number): string {
  const variable = model.variables[id];
  return formatter(variable.unit)(value * (variable.scale ?? 1));
}

function trim(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toLocaleString("en", { maximumFractionDigits: digits });
}
