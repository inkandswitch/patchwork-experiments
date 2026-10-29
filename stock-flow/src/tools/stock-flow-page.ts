import { element, escapeHtml } from "../charts/svg.ts";
import { causalGraph, type GraphLink } from "../engine/graph.ts";
import { cachedRun, scenarioSettings } from "../engine/scenarios.ts";
import { resolveParameters, simulate } from "../engine/simulate.ts";
import { formatParameter } from "../views/format.ts";
import { createInputEditor } from "../views/input-editor.ts";
import { createStockFlowDiagram, type StockFlowDiagram } from "../views/stock-flow-diagram.ts";
import { hideTooltip, linkTooltip, showTooltip } from "../views/tooltip.ts";
import { placeLayout, viewVariables } from "../views/view-layout.ts";
import { currentSettings, type Context, type ViewState } from "./model-state.ts";
import type { Parameter, ParameterId, Settings, StockFlowModelDoc } from "../types.ts";

/**
 * The full model as stocks and flows, with the delays, parameters, loops and input curves to tweak. Dragging a
 * control re-runs the model and refreshes the diagram in place; letting go re-renders the page.
 */
export function renderStockFlowPage(body: HTMLElement, { model, state, rerender }: Context, tooltip: HTMLElement): void {
  const plain = scenarioSettings(model, state.scenario!);
  const plainRun = cachedRun(model, plain);
  const visible = viewVariables(model, "stockFlow");
  const graph = causalGraph(model, plainRun, plain, visible ? { visible } : {});
  state.expanded ??= new Set(graph.nodes.filter((id) => model.variables[id].kind === "stock"));
  const expanded = state.expanded;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Stock and flow diagram of ${model.title}`);
  let settings = currentSettings(model, state);
  const diagram = createStockFlowDiagram(svg, model, graph, placeLayout(model, "stockFlow", graph), {
    expanded,
    onToggle: (id) => {
      if (!expanded.delete(id)) expanded.add(id);
      rerender();
    },
    onLinkHover: (link, event) => (link && event ? showTooltip(tooltip, linkTooltip(model, settings, link), event) : hideTooltip(tooltip)),
  });

  const controls = element("aside", { class: "sf-controls-panel" });
  const editor = createInputEditor(model, {
    curve: (id) => settings.inputs[id] ?? Array.from({ length: model.simulation.years + 1 }, () => 1),
    draw: (id, curve) => {
      state.inputs[id] = curve;
      settings = currentSettings(model, state);
    },
    preview: () => update(),
    commit: rerender,
    onHover: (id) =>
      diagram.highlightLinks(id ? graph.links.filter((link) => link.from === id).map((link) => `${link.from}→${link.to}`) : null, id ? [id] : []),
  });
  const refreshers: ((settings: Settings) => void)[] = [];

  const update = () => {
    settings = currentSettings(model, state);
    const tweaked = JSON.stringify(settings) !== JSON.stringify(plain);
    const parameters = resolveParameters(model, settings);
    diagram.fill({ settings, parameters, run: tweaked ? simulate(model, settings) : plainRun, reference: tweaked ? plainRun : undefined });
    for (const refresh of refreshers) refresh(settings);
    editor.refresh(parameters, inputDescription(model, state));
  };

  const ranged = Object.entries(model.parameters).filter(([, parameter]) => parameter.range && "value" in parameter);
  const delays = ranged.filter(([, parameter]) => parameter.delay);
  const others = ranged.filter(([, parameter]) => !parameter.delay);
  if (delays.length) controls.append(element("h2", {}, "Delays"));
  for (const [id, parameter] of delays) controls.append(parameterField(id, parameter, state, update, rerender, refreshers, diagram, graph.links));
  if (others.length) controls.append(element("h2", {}, "Parameters"));
  for (const [id, parameter] of others) controls.append(parameterField(id, parameter, state, update, rerender, refreshers, diagram, graph.links));
  if (Object.keys(model.annotations.loops).length) controls.append(element("h2", {}, "Feedback loops"));
  for (const id of Object.keys(model.annotations.loops)) controls.append(loopCard(model, id, state, update, rerender, refreshers, diagram, tooltip));

  const panel = element("div", { class: "sf-diagram-panel" });
  panel.append(svg, element("p", { class: "sf-hint" }, "Boxes are stocks. Click a box for its curve; dashed is the scenario as written. ‖ delay, ✕ cut link."));
  const strip = element("div", { class: "sf-input-strip" });
  strip.append(editor.element);
  const box = element("section", { class: "sf-model-box" });
  box.append(controls, panel, strip);
  body.append(box);
  update();
}

function parameterField(
  id: ParameterId,
  parameter: Parameter,
  state: ViewState,
  update: () => void,
  rerender: () => void,
  refreshers: ((settings: Settings) => void)[],
  diagram: StockFlowDiagram,
  links: GraphLink[],
): HTMLElement {
  const range = parameter.range!;
  const field = element("label", { class: "sf-field", title: parameter.label });
  const output = element("output");
  const input = element("input", { type: "range", min: String(range.min), max: String(range.max), step: String(range.step) });
  field.append(parameter.meaning || parameter.label, " ", output, input);
  input.addEventListener("input", () => {
    state.overrides[id] = Number(input.value);
    update();
  });
  input.addEventListener("change", rerender);
  if (parameter.delay) {
    const delayed = () => links.filter((link) => link.delays.includes(id)).map((link) => `${link.from}→${link.to}`);
    field.addEventListener("mouseenter", () => diagram.highlightLinks(delayed()));
    field.addEventListener("mouseleave", () => diagram.highlightLinks(null));
  }
  refreshers.push((settings) => {
    const value = settings.parameters[id] ?? ("value" in parameter ? parameter.value : 0);
    input.value = String(value);
    output.textContent = formatParameter(value, parameter.format);
  });
  return field;
}

function loopCard(
  model: StockFlowModelDoc,
  id: string,
  state: ViewState,
  update: () => void,
  rerender: () => void,
  refreshers: ((settings: Settings) => void)[],
  diagram: StockFlowDiagram,
  tooltip: HTMLElement,
): HTMLElement {
  const loop = model.annotations.loops[id];
  const card = element("article", { class: "sf-loop-card" });
  card.innerHTML = `
    <label class="sf-toggle"><input type="checkbox" /><span class="sf-pill">${escapeHtml(loop.label)}</span><span class="sf-loop-title">${escapeHtml(loop.name)}</span></label>
    <label class="sf-strength"><input type="range" min="0.2" max="2" step="0.1" aria-label="${escapeHtml(loop.name)} strength" /><output></output></label>`;
  const checkbox = card.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  const slider = card.querySelector<HTMLInputElement>("input[type=range]")!;
  const output = card.querySelector("output")!;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.cuts.delete(id);
    else state.cuts.add(id);
    rerender();
  });
  slider.addEventListener("input", () => {
    state.gains[id] = Number(slider.value);
    if (state.gains[id] === 1) delete state.gains[id];
    update();
  });
  slider.addEventListener("change", rerender);
  card.addEventListener("mouseenter", () => {
    diagram.highlightLoop(id);
    showTooltip(
      tooltip,
      `<strong>${escapeHtml(loop.label)} ${escapeHtml(loop.name)}</strong><p>${escapeHtml(loop.story)}</p>
       <p class="sf-cut-note">Off cuts ${loop.cut.map((link) => escapeHtml(link.replace("→", " → "))).join(" and ")}. The strength multiplies ${loop.cut.length === 1 ? "that link" : "those links"}.</p>`,
      card,
    );
  });
  card.addEventListener("mouseleave", () => {
    diagram.highlightLoop(null);
    hideTooltip(tooltip);
  });
  refreshers.push(() => {
    const on = !state.cuts.has(id);
    const strength = state.gains[id] ?? 1;
    checkbox.checked = on;
    slider.value = String(strength);
    slider.disabled = !on;
    output.textContent = `${strength.toFixed(1)}×`;
    card.classList.toggle("off", !on);
  });
  return card;
}

function inputDescription(model: StockFlowModelDoc, state: ViewState): string {
  const scenario = model.scenarios[state.scenario!]?.label ?? state.scenario;
  const redrawn = Object.keys(state.inputs).map((id) => model.variables[id]?.label ?? id);
  return redrawn.length
    ? `Your own curves for ${redrawn.join(", ")}; the rest from "${scenario}". Reset at the top undoes them.`
    : `The curves of "${scenario}". Drag across one to redraw it.`;
}
