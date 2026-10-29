import { escapeHtml } from "../charts/svg.ts";
import type { GraphLink } from "../engine/graph.ts";
import { resolveParameters } from "../engine/simulate.ts";
import { formatParameter } from "./format.ts";
import type { Settings, StockFlowModelDoc, VariableId } from "../types.ts";

export function linkTooltip(model: StockFlowModelDoc, settings: Settings, link: GraphLink): string {
  const label = (id: VariableId) => escapeHtml(model.variables[id].label);
  const sign = { "+": "More of one, more of the other", "−": "More of one, less of the other", "±": "Its sign changes during the run", "0": "Never acts in this run" }[
    link.polarity
  ];
  const explanation = model.annotations.links[`${link.from}→${link.to}`];
  const parameters = resolveParameters(model, settings);
  const delays = link.delays.map((id) => `${escapeHtml(model.parameters[id].meaning)} (${formatParameter(parameters[id], "years")})`);
  const cutBy = Object.values(model.annotations.loops).filter((loop) => loop.cut.some((cut) => link.via.includes(cut)));
  const between = [...new Set(link.via.flatMap((via) => via.split("→")))].filter((id) => id !== link.from && id !== link.to);
  return `<strong>${label(link.from)} → ${label(link.to)}</strong> <b>${link.polarity}</b>
    <p>${sign}.</p>
    ${explanation ? `<p>${escapeHtml(explanation)}</p>` : ""}
    ${delays.length ? `<p>Delayed: ${delays.join(", ")}.</p>` : ""}
    ${between.length ? `<p class="sf-muted">Through ${between.map(label).join(", ")}.</p>` : ""}
    ${cutBy.length ? `<p class="sf-cut-note">Switching off ${cutBy.map((loop) => `${escapeHtml(loop.label)} ${escapeHtml(loop.name)}`).join(" or ")} cuts it.</p>` : ""}`;
}

/** Near the pointer, or beside an element. */
export function showTooltip(tooltip: HTMLElement, html: string, at: MouseEvent | Element): void {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  if (at instanceof Element) {
    const rect = at.getBoundingClientRect();
    tooltip.style.left = `${Math.min(rect.right + 10, window.innerWidth - 310)}px`;
    tooltip.style.top = `${Math.min(rect.top, window.innerHeight - tooltip.offsetHeight - 8)}px`;
    return;
  }
  tooltip.style.left = `${Math.min(at.clientX + 14, window.innerWidth - 310)}px`;
  tooltip.style.top = `${Math.min(at.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8)}px`;
}

export function hideTooltip(tooltip: HTMLElement): void {
  tooltip.hidden = true;
}
