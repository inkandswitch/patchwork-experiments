import { element, escapeHtml } from "../charts/svg.ts";
import { causalGraph, type GraphLoop } from "../engine/graph.ts";
import { renderLoopDiagram, type Highlighter } from "../views/loop-diagram.ts";
import { hideTooltip, linkTooltip, showTooltip } from "../views/tooltip.ts";
import { placeLayout, viewVariables } from "../views/view-layout.ts";
import type { Context } from "./model-state.ts";
import type { StockFlowModelDoc } from "../types.ts";

/** The causal loop diagram derived from the equations, with the named loops beside it. */
export function renderLoopsPage(body: HTMLElement, { model, state, settings, run, rerender }: Context, tooltip: HTMLElement): void {
  const visible = state.allVariables ? undefined : viewVariables(model, "loops");
  const graph = causalGraph(model, run, settings, visible ? { visible } : { all: state.allVariables });
  const layout = placeLayout(state.allVariables ? { ...model, layout: undefined } : model, "loops", graph);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Causal loop diagram of ${model.title}`);
  const diagram = renderLoopDiagram(svg, model, graph, layout, {
    off: state.cuts,
    onLinkHover: (link, event) => (link && event ? showTooltip(tooltip, linkTooltip(model, settings, link), event) : hideTooltip(tooltip)),
  });

  const side = element("aside", { class: "sf-loops-side" });
  side.append(element("h2", {}, "Feedback loops"));
  for (const [id, annotation] of Object.entries(model.annotations.loops)) {
    const cycles = graph.loops.filter((loop) => loop.named.includes(id));
    const card = element("article", { class: `sf-legend-loop${state.cuts.has(id) ? " off" : ""}` });
    card.innerHTML = `<h3><span class="sf-pill">${escapeHtml(annotation.label)}</span> ${escapeHtml(annotation.name)}</h3><p>${escapeHtml(annotation.story)}</p>`;
    if (state.cuts.has(id)) card.append(element("p", { class: "sf-cut-note" }, "Switched off."));
    card.append(cycleList(model, cycles, diagram));
    card.addEventListener("mouseenter", () => diagram.highlightLoop(id));
    card.addEventListener("mouseleave", () => diagram.highlightLoop(null));
    side.append(card);
  }
  side.append(element("h2", {}, "Reading the diagram"), key());
  const unnamed = graph.loops.filter((loop) => !loop.named.length);
  if (unnamed.length) {
    const other = element("details", { class: "sf-legend-loop" });
    other.append(element("summary", {}, `Other loops in the equations (${unnamed.length})`));
    for (const cycle of unnamed.slice(0, 40)) other.append(cycleLine(model, cycle, diagram));
    side.append(other);
  }
  const every = element("label", { class: "sf-hint sf-check" });
  const box = element("input", { type: "checkbox" });
  box.checked = state.allVariables;
  box.addEventListener("change", () => {
    state.allVariables = box.checked;
    rerender();
  });
  every.append(box, " Show every variable instead of folding the ones in between");
  side.append(
    every,
    element(
      "p",
      { class: "sf-hint" },
      `Read from the equations as they act in "${model.scenarios[state.scenario!]?.label ?? state.scenario}". Variables left out are folded into the arrows between the ones shown; 0 marks a link that never acts in this run.`,
    ),
  );

  const grid = element("div", { class: "sf-loops-view" });
  grid.append(svg, side);
  body.append(grid);
}

/** The cycles that make up a named loop, as the equations have them. */
function cycleList(model: StockFlowModelDoc, cycles: GraphLoop[], diagram: Highlighter): HTMLElement {
  const details = element("details", { class: "sf-cycles" });
  details.append(element("summary", {}, cycles.length === 1 ? "1 cycle in the equations" : `${cycles.length} cycles in the equations`));
  for (const cycle of cycles) details.append(cycleLine(model, cycle, diagram));
  if (!cycles.length) details.append(element("div", { class: "sf-cycle" }, "None passes through its links in this view."));
  return details;
}

function cycleLine(model: StockFlowModelDoc, cycle: GraphLoop, diagram: Highlighter): HTMLElement {
  const letter = { balancing: "B", reinforcing: "R", mixed: "±", inactive: "0" }[cycle.polarity];
  const line = element("div", { class: "sf-cycle", title: cycle.polarity });
  line.innerHTML = `<span class="sf-badge ${cycle.polarity}">${letter}</span> ${cycle.variables.map((id) => escapeHtml(model.variables[id].label)).join(" → ")}`;
  line.addEventListener("mouseenter", (event) => {
    event.stopPropagation();
    diagram.highlightLinks(cycle.links);
  });
  line.addEventListener("mouseleave", () => diagram.highlightLinks(null));
  return line;
}

function key(): HTMLElement {
  const list = element("ul", { class: "sf-key" });
  list.innerHTML = `<li><strong>+</strong> both move in the same direction</li>
    <li><strong>−</strong> they move in opposite directions</li>
    <li><strong>‖</strong> the effect arrives with a delay</li>
    <li><em>Italic</em> names are inputs, set from outside the model</li>`;
  return list;
}
