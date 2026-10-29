import { element, escapeHtml } from "../charts/svg.ts";
import { balancedSettings, scenarioSettings } from "../engine/scenarios.ts";
import { multiplierAt } from "../engine/simulate.ts";
import { formatParameter } from "./format.ts";
import type { ScenarioId, Settings, StockFlowModelDoc, VariableId } from "../types.ts";

/** The scenario's question, the expectation written before running it, its input curves and what it changes. */
export function scenarioCard(model: StockFlowModelDoc, id: ScenarioId, actions: HTMLElement[] = []): HTMLElement {
  const scenario = model.scenarios[id];
  if (!scenario) throw new Error(`Unknown scenario "${id}"`);
  const settings = scenarioSettings(model, id);
  const card = element("article", { class: "sf-scenario" });
  card.innerHTML = `
    <header><strong>${escapeHtml(scenario.label)}</strong> <code>${escapeHtml(id)}</code>
      ${scenario.base ? `<span class="sf-muted">on top of <code>${escapeHtml(scenario.base)}</code></span>` : ""}</header>
    <p>${escapeHtml(scenario.question)}</p>
    ${scenario.expectation ? `<p class="sf-expectation">Expected before running: ${escapeHtml(scenario.expectation)}</p>` : ""}
    <div class="sf-curves"></div>
    <ul class="sf-changes"></ul>`;
  const curves = card.querySelector(".sf-curves")!;
  for (const [input, variable] of Object.entries(model.variables)) {
    if (variable.kind === "input") curves.append(curveFigure(model, input, settings));
  }
  const changes = card.querySelector(".sf-changes")!;
  for (const change of describeChanges(model, settings)) changes.append(element("li", {}, change));
  if (scenario.derivedFrom) {
    const details = element("details", { class: "sf-derived" });
    details.append(element("summary", {}, "How the curves were made"), element("p", {}, scenario.derivedFrom.method));
    card.append(details);
  }
  if (actions.length) {
    const footer = element("footer");
    footer.append(...actions);
    card.append(footer);
  }
  return card;
}

/** The input's yearly multipliers as a small curve against the balanced value of 1. */
function curveFigure(model: StockFlowModelDoc, input: VariableId, settings: Settings): HTMLElement {
  const variable = model.variables[input];
  const [low0, high0] = variable.kind === "input" ? variable.range : [0, 2];
  const years = model.simulation.years;
  const values = Array.from({ length: years + 1 }, (_, year) => multiplierAt(settings.inputs[input], year));
  const [width, height, pad] = [160, 44, 4];
  const low = Math.min(low0, ...values);
  const high = Math.max(high0, ...values);
  const x = (year: number) => (year / years) * width;
  const y = (value: number) => pad + (height - 2 * pad) * (1 - (value - low) / (high - low || 1));
  const line = values.map((value, year) => `${year ? "L" : "M"}${x(year).toFixed(1)},${y(value).toFixed(1)}`).join("");
  const unchanged = values.every((value) => value === 1);
  const start = model.simulation.startYear;
  const figure = element("figure", { class: `sf-curve${unchanged ? " unchanged" : ""}` });
  figure.innerHTML = `
    <figcaption>${escapeHtml(variable.label)}</figcaption>
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(variable.label)} by year">
      <title>${values.map((value, year) => `${start + year}: ×${value}`).join("\n")}</title>
      <line class="balance" x1="0" x2="${width}" y1="${y(1)}" y2="${y(1)}" />
      <path class="line" d="${line}" />
    </svg>
    <div class="sf-curve-axis"><span>${start}</span><output>${range(values)}</output><span>${start + years}</span></div>`;
  return figure;
}

function describeChanges(model: StockFlowModelDoc, settings: Settings): string[] {
  const base = balancedSettings(model);
  const changes: string[] = [];
  for (const [id, value] of Object.entries(settings.parameters)) {
    const parameter = model.parameters[id];
    if (value === base.parameters[id] || !parameter) continue;
    changes.push(`${parameter.meaning || parameter.label}: ${formatParameter(value, parameter.format)} instead of ${formatParameter(base.parameters[id], parameter.format)}`);
  }
  for (const [link, gain] of Object.entries(settings.linkGain)) {
    if (gain === 1) continue;
    const loop = Object.values(model.annotations.loops).find((candidate) => candidate.cut.includes(link));
    changes.push(`${link}${loop ? ` (${loop.label} ${loop.name})` : ""}: ${gain === 0 ? "cut" : `gain ${gain}`}`);
  }
  if (settings.dt !== base.dt) changes.push(`Time step: 1/${Math.round(1 / settings.dt)} year instead of 1/${Math.round(1 / base.dt)}`);
  return changes;
}

function range(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return low === high ? percent(low) : `${percent(low)} to ${percent(high)}`;
}
