import { formatter } from "../charts/resolve.ts";
import { element, escapeHtml } from "../charts/svg.ts";
import { outcomeFormatter, outcomeLabel } from "../engine/outcomes.ts";
import { runSensitivity, type SensitivityFields, type SensitivityResult } from "../engine/sensitivity.ts";
import type { StockFlowModelDoc } from "../types.ts";

/** One-at-a-time: a tornado chart per outcome. Latin hypercube: quantiles per outcome. Both: the ranking, if asked for. */
export function sensitivityView(model: StockFlowModelDoc, fields: SensitivityFields, title = ""): HTMLElement {
  const result = runSensitivity(model, fields);
  const box = element("div", { class: "sf-sensitivity" });
  const heading = title || `Sensitivity of "${model.scenarios[fields.scenario]?.label ?? fields.scenario}"`;
  box.append(element("h3", {}, heading));
  const formats = fields.outcomes.map((outcome) => outcomeFormatter(model, outcome, formatter));
  if (fields.method.kind === "one-at-a-time") {
    const grid = element("div", { class: "sf-tornadoes" });
    fields.outcomes.forEach((outcome, index) => grid.append(tornado(model, result, index, outcomeLabel(model, outcome), formats[index])));
    box.append(grid);
  } else {
    box.append(quantileTable(model, fields, result, formats));
  }
  if (result.ranking) box.append(rankingList(model, fields, result));
  box.append(
    element(
      "p",
      { class: "sf-hint" },
      fields.method.kind === "one-at-a-time"
        ? `Each parameter pushed to the ends of its range with the others at their values. Ranges: ${Object.entries(result.ranges)
            .map(([id, range]) => `${id} ${tidy(range.min)}–${tidy(range.max)}`)
            .join(", ")}.`
        : `${fields.method.samples} Latin hypercube samples (seed ${fields.method.seed}) over ${Object.keys(result.ranges).join(", ")}; every parameter varies at once.`,
    ),
  );
  return box;
}

function tornado(model: StockFlowModelDoc, result: SensitivityResult, index: number, label: string, format: (value: number) => string): HTMLElement {
  const base = result.base[index];
  const bars = Object.entries(result.ranges)
    .map(([id, range]) => {
      const [low, high] = result.samples.filter((sample) => sample.varied === id).map((sample) => sample.outcomes[index]);
      return { id, label: model.parameters[id]?.label || id, range, low, high, swing: Math.abs(high - low) };
    })
    .filter((bar) => Number.isFinite(bar.low) && Number.isFinite(bar.high))
    .sort((a, b) => b.swing - a.swing);
  const figure = element("figure", { class: "sf-tornado" });
  if (!bars.length) {
    figure.innerHTML = `<figcaption>${escapeHtml(label)}</figcaption><p class="sf-muted">No finite values</p>`;
    return figure;
  }
  const extent = Math.max(...bars.flatMap((bar) => [Math.abs(bar.low - base), Math.abs(bar.high - base)])) || 1;
  const [width, rowHeight, labelWidth, pad] = [420, 22, 150, 56];
  const plotWidth = width - labelWidth - 2 * pad;
  const centre = labelWidth + pad + plotWidth / 2;
  const x = (value: number) => centre + ((value - base) / extent) * (plotWidth / 2);
  const height = bars.length * rowHeight + 24;
  const rows = bars
    .map((bar, i) => {
      const y = 12 + i * rowHeight;
      const segment = (value: number, cls: string) =>
        `<rect class="${cls}" x="${Math.min(x(value), centre).toFixed(1)}" y="${y + 3}" width="${Math.abs(x(value) - centre).toFixed(1)}" height="${rowHeight - 6}"><title>${escapeHtml(bar.id)} = ${cls === "low" ? tidy(bar.range.min) : tidy(bar.range.max)} → ${escapeHtml(format(value))}</title></rect>`;
      return `
        <text class="bar-label" x="${labelWidth + pad - 8}" y="${y + rowHeight / 2}" text-anchor="end" dominant-baseline="middle">${escapeHtml(bar.label)}</text>
        ${segment(bar.low, "low")}${segment(bar.high, "high")}
        <text class="end-label" x="${(Math.min(x(bar.low), x(bar.high)) - 4).toFixed(1)}" y="${y + rowHeight / 2}" text-anchor="end" dominant-baseline="middle">${escapeHtml(format(Math.min(bar.low, bar.high)))}</text>
        <text class="end-label" x="${(Math.max(x(bar.low), x(bar.high)) + 4).toFixed(1)}" y="${y + rowHeight / 2}" text-anchor="start" dominant-baseline="middle">${escapeHtml(format(Math.max(bar.low, bar.high)))}</text>`;
    })
    .join("");
  figure.innerHTML = `
    <figcaption>${escapeHtml(label)} <span class="sf-muted">base ${escapeHtml(format(base))}</span></figcaption>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} tornado">
      <line class="centre" x1="${centre}" x2="${centre}" y1="6" y2="${height - 6}"/>
      ${rows}
    </svg>`;
  return figure;
}

function quantileTable(model: StockFlowModelDoc, fields: SensitivityFields, result: SensitivityResult, formats: ((value: number) => string)[]): HTMLElement {
  const table = element("table");
  const rows = fields.outcomes.map((outcome, index) => {
    const values = result.samples.map((sample) => sample.outcomes[index]).filter(Number.isFinite).sort((a, b) => a - b);
    const quantile = (q: number) => (values.length ? formats[index](values[Math.min(values.length - 1, Math.floor(q * values.length))]) : "–");
    const never = result.samples.length - values.length;
    return `<tr><td>${escapeHtml(outcomeLabel(model, outcome))}</td><td class="num">${escapeHtml(formats[index](result.base[index]))}</td><td class="num">${quantile(0.05)}</td><td class="num">${quantile(0.5)}</td><td class="num">${quantile(0.95)}</td><td class="num">${never ? `${never} never` : ""}</td></tr>`;
  });
  table.innerHTML = `<thead><tr><th>Outcome</th><th>Base</th><th>5%</th><th>Median</th><th>95%</th><th></th></tr></thead><tbody>${rows.join("")}</tbody>`;
  return table;
}

function rankingList(model: StockFlowModelDoc, fields: SensitivityFields, result: SensitivityResult): HTMLElement {
  const ranking = fields.ranking!;
  const box = element("div", { class: "sf-ranking" });
  box.append(element("h2", {}, `Which scenario has the ${ranking.lowerIsBetter ? "lowest" : "highest"} ${outcomeLabel(model, fields.outcomes[ranking.outcome]).toLowerCase()}?`));
  const list = element("ul");
  for (const { scenario, wins } of result.ranking!) {
    const item = element("li");
    const bar = element("span", { class: "sf-win-bar" });
    bar.style.width = `${Math.round(wins * 100)}%`;
    item.append(bar, `${model.scenarios[scenario]?.label ?? scenario}: ${(wins * 100).toFixed(0)}% of samples`);
    list.append(item);
  }
  box.append(list);
  return box;
}

function tidy(value: number): string {
  return String(Number(value.toPrecision(6)));
}
