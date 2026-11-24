import { formatter } from "../charts/resolve.ts";
import { element, escapeHtml } from "../charts/svg.ts";
import { attribute, type AttributionFields } from "../engine/attribution.ts";
import { outcomeFormatter, outcomeLabel } from "../engine/outcomes.ts";
import type { StockFlowModelDoc } from "../types.ts";

/** Shapley shares as a waterfall from the baseline to the full scenario, with the one-at-a-time effects for comparison. */
export function attributionView(model: StockFlowModelDoc, fields: AttributionFields, title = ""): HTMLElement {
  const result = attribute(model, fields);
  const format = outcomeFormatter(model, fields.outcome, formatter);
  const box = element("div", { class: "sf-attribution" });
  const heading = title || `${outcomeLabel(model, fields.outcome)} in "${model.scenarios[fields.scenario]?.label ?? fields.scenario}"`;
  const steps = [
    { label: "All drivers off", from: 0, to: result.baseline, kind: "level" },
    ...Object.entries(result.shares).reduce<{ label: string; from: number; to: number; kind: string }[]>((acc, [id, share]) => {
      const from = acc.length ? acc[acc.length - 1].to : result.baseline;
      acc.push({ label: fields.drivers[id].label, from, to: from + share, kind: share >= 0 ? "up" : "down" });
      return acc;
    }, []),
    { label: "Full scenario", from: 0, to: result.baseline + result.total, kind: "level" },
  ];
  const values = steps.flatMap((step) => [step.from, step.to]);
  const [low, high] = [Math.min(0, ...values), Math.max(0, ...values)];
  const [width, height, pad, bottom] = [460, 220, 12, 48];
  const columnWidth = (width - 2 * pad) / steps.length;
  const y = (value: number) => pad + (1 - (value - low) / (high - low || 1)) * (height - pad - bottom);
  const bars = steps
    .map((step, index) => {
      const x = pad + index * columnWidth + columnWidth * 0.15;
      const top = Math.min(y(step.from), y(step.to));
      const barHeight = Math.max(1, Math.abs(y(step.from) - y(step.to)));
      const words = step.label.split(" ");
      const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [step.label];
      return `
        <rect class="${step.kind}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(columnWidth * 0.7).toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${escapeHtml(step.label)}: ${escapeHtml(format(step.kind === "level" ? step.to : step.to - step.from))}</title></rect>
        <text class="value" x="${(x + columnWidth * 0.35).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle">${escapeHtml(format(step.kind === "level" ? step.to : step.to - step.from))}</text>
        ${lines.map((line, i) => `<text class="label" x="${(x + columnWidth * 0.35).toFixed(1)}" y="${height - bottom + 14 + i * 12}" text-anchor="middle">${escapeHtml(line)}</text>`).join("")}
        ${index < steps.length - 1 ? `<line class="connector" x1="${(x + columnWidth * 0.7).toFixed(1)}" x2="${(x + columnWidth * 1.15).toFixed(1)}" y1="${y(step.to).toFixed(1)}" y2="${y(step.to).toFixed(1)}"/>` : ""}`;
    })
    .join("");
  const share = (value: number) => (result.total ? `${((value / result.total) * 100).toFixed(0)}%` : "–");
  const bands = result.bands;
  const band = (id: string) => (bands ? `<td class="num band">${escapeHtml(format(bands.shares[id].low))} … ${escapeHtml(format(bands.shares[id].high))}</td>` : "");
  const rows = Object.entries(result.shares)
    .map(([id, value]) => `<tr><td>${escapeHtml(fields.drivers[id].label)}</td><td class="num">${escapeHtml(format(value))}</td><td class="num">${share(value)}</td><td class="num">${escapeHtml(format(result.oneAtATime[id]))}</td>${band(id)}</tr>`)
    .join("");
  const whiskers = bands
    ? steps
        .slice(1, -1)
        .map((step, index) => {
          const id = Object.keys(result.shares)[index];
          const x = pad + (index + 1) * columnWidth + columnWidth * 0.5;
          const [lo, hi] = [y(step.from + bands.shares[id].low), y(step.from + bands.shares[id].high)];
          return `<line class="whisker" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${lo.toFixed(1)}" y2="${hi.toFixed(1)}"><title>5–95% band over ${bands.samples} samples</title></line><line class="whisker" x1="${(x - 6).toFixed(1)}" x2="${(x + 6).toFixed(1)}" y1="${lo.toFixed(1)}" y2="${lo.toFixed(1)}"/><line class="whisker" x1="${(x - 6).toFixed(1)}" x2="${(x + 6).toFixed(1)}" y1="${hi.toFixed(1)}" y2="${hi.toFixed(1)}"/>`;
        })
        .join("")
    : "";
  box.innerHTML = `
    <h3>${escapeHtml(heading)}</h3>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Attribution waterfall">
      <line class="zero" x1="${pad}" x2="${width - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
      ${bars}
      ${whiskers}
    </svg>
    <table>
      <thead><tr><th>Driver</th><th>Shapley share</th><th>Of total</th><th>Alone</th>${bands ? "<th>5–95% band</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total to explain</td><td class="num">${escapeHtml(format(result.total))}</td><td class="num">100%</td><td class="num">${escapeHtml(format(result.total - result.interaction))}</td>${bands ? `<td class="num band">${escapeHtml(format(bands.total.low))} … ${escapeHtml(format(bands.total.high))}</td>` : ""}</tr></tfoot>
    </table>
    <p class="sf-hint">Shapley shares are each driver's average marginal effect over every order of switching the drivers on; they add up to the total. "Alone" is the effect of that driver by itself. The gap between the two columns' sums, ${escapeHtml(format(result.interaction))}, is interaction: the drivers matter more together than apart.${bands ? ` Whiskers and the band column are the 5th to 95th percentile over ${bands.samples} Latin-hypercube samples of ${escapeHtml(Object.keys(fields.uncertainty!.parameters).join(", "))}.` : ""}</p>`;
  return box;
}
