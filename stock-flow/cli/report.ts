import { formatter } from "../src/charts/resolve.ts";
import { outcomeFormatter, outcomeLabel } from "../src/engine/outcomes.ts";
import type { SensitivityFields, SensitivityResult } from "../src/engine/sensitivity.ts";
import { testLabel } from "../src/engine/tests.ts";
import type { AttributionFields } from "../src/engine/attribution.ts";
import type { Attribution, StockFlowModelDoc, TestResult } from "../src/types.ts";

/** Plain-text versions of the three views, for `sf tests`, `sf sensitivity` and `sf attribution`. */
export function testsReport(results: TestResult[]): string {
  const mark = { pass: "pass", warn: "WARN", fail: "FAIL" };
  const lines = results.map((result) => `${mark[result.status].padEnd(4)}  ${testLabel(result.spec)}\n      ${result.summary}`);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const result of results) counts[result.status]++;
  return [...lines, "", `${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`].join("\n");
}

export function sensitivityReport(model: StockFlowModelDoc, fields: SensitivityFields, result: SensitivityResult): string {
  const lines: string[] = [];
  const formats = fields.outcomes.map((outcome) => outcomeFormatter(model, outcome, formatter));
  lines.push(`Base (${fields.scenario}): ${fields.outcomes.map((outcome, index) => `${outcomeLabel(model, outcome)} = ${formats[index](result.base[index])}`).join("; ")}`);
  if (fields.method.kind === "one-at-a-time") {
    for (const [index, outcome] of fields.outcomes.entries()) {
      lines.push("", `${outcomeLabel(model, outcome)}: low → high end of each parameter's range`);
      const rows = Object.entries(result.ranges).map(([id, range]) => {
        const [low, high] = result.samples.filter((sample) => sample.varied === id).map((sample) => sample.outcomes[index]);
        return { cells: [`${id} ${tidy(range.min)}–${tidy(range.max)}`, formats[index](low), formats[index](high), formats[index](high - low)], swing: Math.abs(high - low) };
      });
      rows.sort((a, b) => b.swing - a.swing);
      lines.push(table(["parameter", "at min", "at max", "swing"], rows.map((row) => row.cells)));
    }
  } else {
    lines.push("", `${result.samples.length} Latin hypercube samples over ${Object.keys(result.ranges).join(", ")}`);
    const rows = fields.outcomes.map((outcome, index) => {
      const values = result.samples.map((sample) => sample.outcomes[index]).filter(Number.isFinite).sort((a, b) => a - b);
      const quantile = (q: number) => (values.length ? formats[index](values[Math.min(values.length - 1, Math.floor(q * values.length))]) : "–");
      return [outcomeLabel(model, outcome), quantile(0.05), quantile(0.5), quantile(0.95)];
    });
    lines.push(table(["outcome", "5%", "median", "95%"], rows));
  }
  if (result.ranking) {
    lines.push("", `Ranking on ${outcomeLabel(model, fields.outcomes[fields.ranking!.outcome])} (${fields.ranking!.lowerIsBetter ? "lower" : "higher"} is better):`);
    for (const { scenario, wins } of result.ranking) lines.push(`  ${scenario}: wins in ${(wins * 100).toFixed(0)}% of samples`);
  }
  return lines.join("\n");
}

export function attributionReport(model: StockFlowModelDoc, fields: AttributionFields, result: Attribution): string {
  const format = outcomeFormatter(model, fields.outcome, formatter);
  const share = (value: number) => (result.total ? `${((value / result.total) * 100).toFixed(0)}%` : "–");
  const band = (id: string) => (result.bands ? `${format(result.bands.shares[id].low)} … ${format(result.bands.shares[id].high)}` : "");
  const rows = Object.entries(result.shares).map(([id, value]) => [fields.drivers[id].label, format(value), share(value), format(result.oneAtATime[id]), ...(result.bands ? [band(id)] : [])]);
  return [
    `${outcomeLabel(model, fields.outcome)} in "${fields.scenario}": ${format(result.baseline + result.total)}; with every driver off: ${format(result.baseline)}; total to explain: ${format(result.total)}`,
    "",
    table(["driver", "Shapley share", "of total", "alone", ...(result.bands ? ["5–95% band"] : [])], rows),
    "",
    `Interaction (total minus the sum of one-at-a-time effects): ${format(result.interaction)}`,
    ...(result.bands ? [`Bands from ${result.bands.samples} Latin-hypercube samples of ${Object.keys(fields.uncertainty!.parameters).join(", ")}; total ${format(result.bands.total.low)} … ${format(result.bands.total.high)}`] : []),
  ].join("\n");
}

export function tidy(value: number): string {
  return String(Number(value.toPrecision(6)));
}

export function table(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column ? cell.padStart(widths[column]) : cell.padEnd(widths[column]))).join("  ");
  return [line(header), ...rows.map(line)].join("\n");
}
