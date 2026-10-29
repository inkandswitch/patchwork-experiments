import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { formatter, modelPoints, type ChartSpec, type Series } from "../charts/resolve.ts";
import { element, escapeHtml, renderChart } from "../charts/svg.ts";
import { causalGraph, type CausalGraph, type GraphLink, type GraphLoop } from "../engine/graph.ts";
import { cachedRun, orderedScenarios, scenarioSettings, withKnob } from "../engine/scenarios.ts";
import { resolveParameters } from "../engine/simulate.ts";
import { diagramSvg, key, layoutDiagram } from "../views/diagram.ts";
import { formatParameter, formatVariable } from "../views/format.ts";
import { scenarioCard } from "../views/scenario-card.ts";
import { errorMessage, mount, onResize, watch } from "./shared.ts";
import type { LoopId, Run, Settings, StockFlowModelDoc, VariableId } from "../types.ts";

export const ModelTool: ToolRender<StockFlowModelDoc> = (handle, element) => {
  const { root, unmount } = mount(element, "sf-model");
  const view = createModelView(root);
  const stop = watch(handle, view.update);
  return () => {
    stop();
    view.destroy();
    unmount();
  };
};

type Tab = "loops" | "run" | "equations" | "parameters" | "scenarios" | "data";

const TABS: [Tab, string][] = [
  ["loops", "Loops"],
  ["run", "Run"],
  ["equations", "Equations"],
  ["parameters", "Parameters"],
  ["scenarios", "Scenarios"],
  ["data", "Data"],
];

/** What the reader has picked. Kept in the view only: the document is changed through the CLI. */
type ViewState = {
  tab: Tab;
  scenario?: string;
  cuts: Set<LoopId>;
  overrides: Record<string, number>;
  allVariables: boolean;
  charted?: VariableId[];
  year?: number;
};

type Context = { model: StockFlowModelDoc; state: ViewState; settings: Settings; run: Run; rerender: () => void };

function createModelView(root: HTMLElement) {
  const state: ViewState = { tab: "loops", cuts: new Set(), overrides: {}, allVariables: false };
  const header = element("header");
  const body = element("div", { class: "sf-body" });
  const tooltip = element("div", { class: "sf-tooltip" });
  tooltip.hidden = true;
  root.append(header, body, tooltip);
  let model: StockFlowModelDoc | undefined;

  const render = () => {
    if (!model) return;
    const current = model;
    if (!state.scenario || !(state.scenario in current.scenarios)) state.scenario = orderedScenarios(current)[0]?.[0] ?? "balanced";
    renderHeader(header, current, state, render);
    try {
      const settings = currentSettings(current, state);
      const context: Context = { model: current, state, settings, run: cachedRun(current, settings), rerender: render };
      body.replaceChildren();
      TAB_RENDERERS[state.tab](body, context, tooltip);
    } catch (error) {
      body.replaceChildren(element("p", { class: "sf-error" }, errorMessage(error)));
    }
  };
  const stopResize = onResize(body, render);

  return {
    update(doc: StockFlowModelDoc) {
      model = doc;
      render();
    },
    destroy: stopResize,
  };
}

function currentSettings(model: StockFlowModelDoc, state: ViewState): Settings {
  const reference = state.cuts.size ? `${state.scenario} without ${[...state.cuts].join(" and ")}` : state.scenario!;
  let settings = scenarioSettings(model, reference);
  for (const [knob, value] of Object.entries(state.overrides)) settings = withKnob(model, settings, knob, value);
  return settings;
}

function renderHeader(header: HTMLElement, model: StockFlowModelDoc, state: ViewState, rerender: () => void): void {
  const tabs = element("nav", { class: "sf-tabs", role: "tablist" });
  for (const [id, label] of TABS) {
    const tab = element("button", { role: "tab", "aria-selected": String(state.tab === id) }, label);
    tab.addEventListener("click", () => {
      state.tab = id;
      rerender();
    });
    tabs.append(tab);
  }
  const scenarios = element("select", { title: "Scenario" });
  for (const [id, scenario] of orderedScenarios(model)) {
    const option = element("option", { value: id }, scenario.label);
    option.selected = id === state.scenario;
    scenarios.append(option);
  }
  scenarios.addEventListener("change", () => {
    state.scenario = scenarios.value;
    rerender();
  });
  const knockouts = element("div", { class: "sf-knockouts" });
  for (const [id, loop] of Object.entries(model.annotations.loops)) {
    const chip = element("label", { class: `sf-chip${state.cuts.has(id) ? " off" : ""}`, title: `${loop.name}: ${loop.story}` });
    const box = element("input", { type: "checkbox" });
    box.checked = !state.cuts.has(id);
    box.addEventListener("change", () => {
      if (box.checked) state.cuts.delete(id);
      else state.cuts.add(id);
      rerender();
    });
    chip.append(box, `${loop.label} ${loop.name}`);
    knockouts.append(chip);
  }
  const bar = element("div", { class: "sf-bar" });
  bar.append(tabs, scenarios, knockouts);
  if (state.cuts.size || Object.keys(state.overrides).length) {
    const reset = element("button", { title: "Back to the scenario as written" }, "Reset");
    reset.addEventListener("click", () => {
      state.cuts.clear();
      state.overrides = {};
      rerender();
    });
    bar.append(reset);
  }
  header.replaceChildren(element("h1", {}, model.title), ...(model.description ? [element("p", {}, model.description)] : []), bar);
}

const TAB_RENDERERS: Record<Tab, (body: HTMLElement, context: Context, tooltip: HTMLElement) => void> = {
  loops: renderLoops,
  run: renderRun,
  equations: renderEquations,
  parameters: renderParameters,
  scenarios: renderScenarios,
  data: renderData,
};

/** The causal loop diagram, derived from the equations, and the loops in it. */
function renderLoops(body: HTMLElement, { model, state, settings, run, rerender }: Context, tooltip: HTMLElement): void {
  const graph = causalGraph(model, run, settings, { all: state.allVariables });
  const layout = layoutDiagram(model, graph);
  const panel = element("div", { class: "sf-diagram-panel" });
  panel.innerHTML = diagramSvg(model, graph, layout);
  const svg = panel.querySelector("svg")!;
  const highlight = (loop: GraphLoop | null) => {
    svg.classList.toggle("highlighting", Boolean(loop));
    for (const node of svg.querySelectorAll<SVGGElement>("[data-link], [data-node]")) {
      const on = loop ? loop.links.includes(node.dataset.link ?? "") || loop.variables.includes(node.dataset.node ?? "") : false;
      node.classList.toggle("on", on);
    }
  };
  const links = new Map(graph.links.map((link) => [key(link), link]));
  for (const edge of svg.querySelectorAll<SVGGElement>("[data-link]")) {
    edge.addEventListener("mousemove", (event) => showTooltip(tooltip, linkTooltip(model, settings, links.get(edge.dataset.link!)!), event));
    edge.addEventListener("mouseleave", () => (tooltip.hidden = true));
  }

  const side = element("aside", { class: "sf-loop-list" });
  const every = element("label", { class: "sf-muted" });
  const box = element("input", { type: "checkbox" });
  box.checked = state.allVariables;
  box.addEventListener("change", () => {
    state.allVariables = box.checked;
    rerender();
  });
  every.append(box, " Show every variable instead of folding the ones in between");
  side.append(
    every,
    element("p", { class: "sf-muted" }, `Signs and loop types as they act in "${model.scenarios[state.scenario!]?.label ?? state.scenario}". 0: the link never acts in this run.`),
  );

  for (const [id, annotation] of Object.entries(model.annotations.loops)) {
    const cycles = graph.loops.filter((loop) => loop.named.includes(id));
    const item = element("article", { class: "sf-loop" });
    const type = cycles[0]?.polarity ?? "inactive";
    item.innerHTML = `<header><span class="sf-badge ${type}">${escapeHtml(annotation.label)}</span><strong>${escapeHtml(annotation.name)}</strong>
      ${state.cuts.has(id) ? `<span class="sf-muted">switched off</span>` : ""}</header><p>${escapeHtml(annotation.story)}</p>`;
    for (const cycle of cycles) item.append(cycleLine(model, cycle, highlight));
    if (!cycles.length) item.append(element("div", { class: "sf-cycle" }, "No cycle passes through its links in this view."));
    item.addEventListener("mouseenter", () => highlight(cycles.length ? merge(cycles) : null));
    item.addEventListener("mouseleave", () => highlight(null));
    side.append(item);
  }
  const unnamed = graph.loops.filter((loop) => !loop.named.length);
  if (unnamed.length) {
    side.append(element("h2", {}, `Other loops (${unnamed.length})`));
    const item = element("article", { class: "sf-loop" });
    for (const cycle of unnamed.slice(0, 40)) item.append(cycleLine(model, cycle, highlight));
    if (unnamed.length > 40) item.append(element("div", { class: "sf-cycle" }, `and ${unnamed.length - 40} more`));
    side.append(item);
  }
  const grid = element("div", { class: "sf-loops" });
  grid.append(panel, side);
  body.append(grid);
}

function cycleLine(model: StockFlowModelDoc, cycle: GraphLoop, highlight: (loop: GraphLoop | null) => void): HTMLElement {
  const letter = { balancing: "B", reinforcing: "R", mixed: "±", inactive: "0" }[cycle.polarity];
  const line = element("div", { class: "sf-cycle" });
  line.innerHTML = `<span class="sf-badge ${cycle.polarity}">${letter}</span> ${cycle.variables.map((id) => escapeHtml(model.variables[id].label)).join(" → ")}`;
  line.addEventListener("mouseenter", (event) => {
    event.stopPropagation();
    highlight(cycle);
  });
  return line;
}

function merge(cycles: GraphLoop[]): GraphLoop {
  return { ...cycles[0], links: cycles.flatMap((cycle) => cycle.links), variables: cycles.flatMap((cycle) => cycle.variables) };
}

function linkTooltip(model: StockFlowModelDoc, settings: Settings, link: GraphLink): string {
  const label = (id: VariableId) => escapeHtml(model.variables[id].label);
  const sign = { "+": "More of one, more of the other", "−": "More of one, less of the other", "±": "Its sign changes during the run", "0": "Never acts in this run" }[
    link.polarity
  ];
  const explanation = model.annotations.links[key(link)];
  const parameters = resolveParameters(model, settings);
  const delays = link.delays.map((id) => `${escapeHtml(model.parameters[id].meaning)} (${formatParameter(parameters[id], "years")})`);
  const cutBy = Object.values(model.annotations.loops).filter((loop) => loop.cut.some((cut) => link.via.includes(cut)));
  const between = [...new Set(link.via.flatMap((via) => via.split("→")))].filter((id) => id !== link.from && id !== link.to);
  return `<strong>${label(link.from)} → ${label(link.to)}</strong> <b>${link.polarity}</b>
    <p>${sign}.</p>
    ${explanation ? `<p>${escapeHtml(explanation)}</p>` : ""}
    ${delays.length ? `<p>Delayed: ${delays.join(", ")}.</p>` : ""}
    ${between.length ? `<p class="sf-muted">Through ${between.map(label).join(", ")}.</p>` : ""}
    ${cutBy.length ? `<p class="sf-muted">Switching off ${cutBy.map((loop) => `${escapeHtml(loop.label)} ${escapeHtml(loop.name)}`).join(" or ")} cuts it.</p>` : ""}`;
}

function showTooltip(tooltip: HTMLElement, html: string, event: MouseEvent): void {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 310)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8)}px`;
}

/** Charts of chosen variables for the scenario with the reader's knockouts and slider settings, against the data. */
function renderRun(body: HTMLElement, { model, state, settings, run, rerender }: Context): void {
  const charted = (state.charted ??= defaultCharted(model)).filter((id) => id in model.variables);
  const plain = scenarioSettings(model, state.scenario!);
  const changed = JSON.stringify(plain) !== JSON.stringify(settings);
  const reference = changed ? cachedRun(model, plain) : undefined;

  const charts = element("div", { class: "sf-charts" });
  const drawCharts = (currentRun: Run, referenceRun?: Run) => {
    charts.replaceChildren();
    for (const id of charted) {
      const box = element("div", { class: "sf-chart-box" });
      charts.append(box);
      renderChart(box, variableChart(model, id, currentRun, referenceRun));
      const remove = element("button", { title: "Remove this chart" }, "Remove");
      remove.addEventListener("click", () => {
        state.charted = charted.filter((other) => other !== id);
        rerender();
      });
      box.querySelector("h3")!.append(" ", remove);
    }
  };

  const controls = element("aside", { class: "sf-controls" });
  const add = element("select");
  add.append(element("option", { value: "" }, "Add a chart…"));
  for (const [id, variable] of Object.entries(model.variables)) {
    if (!charted.includes(id)) add.append(element("option", { value: id }, `${variable.label} (${variable.kind})`));
  }
  add.addEventListener("change", () => {
    if (!add.value) return;
    state.charted = [...charted, add.value];
    rerender();
  });
  controls.append(add);
  const sliders = Object.entries(model.parameters).filter(([, parameter]) => parameter.range && "value" in parameter);
  if (sliders.length) controls.append(element("h2", {}, "Parameters"));
  for (const [id, parameter] of sliders) {
    const range = parameter.range!;
    const field = element("label", { class: "sf-slider", title: parameter.meaning });
    const output = element("output");
    const input = element("input", { type: "range", min: String(range.min), max: String(range.max), step: String(range.step) });
    input.value = String(settings.parameters[id]);
    output.textContent = formatParameter(settings.parameters[id], parameter.format);
    input.addEventListener("input", () => {
      state.overrides[id] = Number(input.value);
      output.textContent = formatParameter(Number(input.value), parameter.format);
      drawCharts(cachedRun(model, currentSettings(model, state)), cachedRun(model, plain));
    });
    input.addEventListener("change", rerender);
    const caption = element("span");
    caption.append(element("span", {}, parameter.meaning || parameter.label), output);
    field.append(caption, input);
    controls.append(field);
  }
  const grid = element("div", { class: "sf-run" });
  grid.append(charts, controls);
  body.append(grid);
  drawCharts(run, reference);
}

function defaultCharted(model: StockFlowModelDoc): VariableId[] {
  const measured = new Set(Object.values(model.data).map((series) => series.variable));
  const ids = Object.keys(model.variables);
  const preferred = ids.filter((id) => model.variables[id].key && measured.has(id));
  return (preferred.length ? preferred : ids.filter((id) => model.variables[id].kind === "stock")).slice(0, 4);
}

/** With a reference run, the reader has changed the scenario and both are drawn. */
function variableChart(model: StockFlowModelDoc, id: VariableId, run: Run, reference?: Run): ChartSpec {
  const variable = model.variables[id];
  const series: Series[] = [{ label: reference ? "As set here" : "Model", points: modelPoints(model, run, id), color: "#4c6ef5" }];
  if (reference) series.push({ label: "Scenario as written", points: modelPoints(model, reference, id), color: "#adb5bd", dashed: true });
  const data = Object.values(model.data).filter((item) => item.variable === id && item.unit === variable.unit && !item.subgroup);
  data.slice(0, 2).forEach((item, index) => series.push({ label: `${item.label} (data)`, points: item.points, color: ["#495057", "#a61e4d"][index], markers: true }));
  return { title: `${variable.label} · ${variable.unit}`, series, format: formatter(variable.unit) };
}

/** Every equation with its value in a chosen year. */
function renderEquations(body: HTMLElement, { model, state, run, rerender }: Context): void {
  const years = run.years.filter(Number.isInteger);
  state.year ??= years[0];
  const index = run.years.indexOf(state.year);
  const picker = element("label", { class: "sf-slider" });
  const input = element("input", { type: "range", min: String(years[0]), max: String(years.at(-1)), step: "1" });
  input.value = String(state.year);
  input.addEventListener("change", () => {
    state.year = Number(input.value);
    rerender();
  });
  const caption = element("span");
  caption.append(element("span", {}, "Values in"), element("output", {}, String(state.year)));
  picker.append(caption, input);
  body.append(picker);

  const groups: [string, (kind: string) => boolean][] = [
    ["Stocks", (kind) => kind === "stock"],
    ["Flows", (kind) => kind === "flow"],
    ["Inputs", (kind) => kind === "input"],
    ["Auxiliaries", (kind) => kind === "auxiliary"],
  ];
  for (const [title, matches] of groups) {
    const rows = Object.entries(model.variables).filter(([, variable]) => matches(variable.kind));
    if (!rows.length) continue;
    const table = element("table");
    table.innerHTML = `<thead><tr><th>Variable</th><th>Equation</th><th>Value</th><th>Unit</th></tr></thead>`;
    const tbody = element("tbody");
    for (const [id, variable] of rows) {
      const equation =
        variable.kind === "stock"
          ? `${id}′ = ${[...variable.inflows, ...variable.outflows.map((flow) => `− ${flow}`)].join(" + ").replace(/\+ −/g, "−") || "0"}\nstarts at ${variable.initial}`
          : variable.kind === "input"
            ? `${variable.base} × drawn curve`
            : variable.equation;
      const row = element("tr");
      row.innerHTML = `<td><strong>${escapeHtml(variable.label)}</strong><br><code>${escapeHtml(id)}</code>${variable.description ? `<br><span class="sf-muted">${escapeHtml(variable.description)}</span>` : ""}</td>
        <td><code>${escapeHtml(equation)}</code></td><td class="num">${formatVariable(model, id, run.values[id][index])}</td><td class="sf-muted">${escapeHtml(variable.unit)}</td>`;
      tbody.append(row);
    }
    table.append(tbody);
    body.append(element("h2", {}, title), table);
  }
}

function renderParameters(body: HTMLElement, { model, settings }: Context): void {
  const values = resolveParameters(model, settings);
  const groups = new Map<string, [string, StockFlowModelDoc["parameters"][string]][]>();
  for (const entry of Object.entries(model.parameters)) groups.set(entry[1].group, [...(groups.get(entry[1].group) ?? []), entry]);
  for (const [group, entries] of groups) {
    const table = element("table");
    table.innerHTML = `<thead><tr><th>Parameter</th><th>Value</th><th>Meaning</th></tr></thead>`;
    const tbody = element("tbody");
    for (const [id, parameter] of entries) {
      const row = element("tr");
      const formula = "derived" in parameter ? `<br><code>= ${escapeHtml(parameter.derived)}</code>` : "";
      const delay = parameter.delay ? `<br><span class="sf-muted">${escapeHtml(parameter.delay.kind)} delay. ${escapeHtml(parameter.delay.shape)}</span>` : "";
      row.innerHTML = `<td><code>${escapeHtml(id)}</code>${parameter.label !== id ? `<br><span class="sf-muted">${escapeHtml(parameter.label)}</span>` : ""}</td>
        <td class="num">${formatParameter(values[id], parameter.format)}</td><td>${escapeHtml(parameter.meaning)}${formula}${delay}</td>`;
      tbody.append(row);
    }
    table.append(tbody);
    body.append(element("h2", {}, group), table);
  }
}

function renderScenarios(body: HTMLElement, { model, state, rerender }: Context): void {
  const grid = element("div", { class: "sf-scenarios" });
  for (const [id] of orderedScenarios(model)) {
    const open = element("button", {}, "Run it");
    open.addEventListener("click", () => {
      state.scenario = id;
      state.tab = "run";
      rerender();
    });
    try {
      grid.append(scenarioCard(model, id, [open]));
    } catch (error) {
      grid.append(element("p", { class: "sf-error" }, `${id}: ${errorMessage(error)}`));
    }
  }
  body.append(grid);
}

function renderData(body: HTMLElement, { model, run }: Context): void {
  const grid = element("div", { class: "sf-data" });
  body.append(grid);
  for (const [id, series] of Object.entries(model.data)) {
    const card = element("article", { class: "sf-series" });
    const variable = model.variables[series.variable];
    const source = series.source;
    card.innerHTML = `<h3>${escapeHtml(series.label)}</h3>
      <div class="sf-muted"><code>${escapeHtml(id)}</code> · ${escapeHtml(series.unit)} · compared with ${escapeHtml(variable?.label ?? series.variable)}</div>
      <p><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.publisher)}: ${escapeHtml(source.title)}</a>${source.table ? ` (${escapeHtml(source.table)})` : ""}.
        ${escapeHtml(source.method)}, retrieved ${escapeHtml(source.retrieved)}.</p>
      <ul>${series.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
    const box = element("div", { class: "sf-chart-box" });
    box.style.height = "200px";
    card.append(box);
    grid.append(card);
    const points: Series[] = [{ label: `${series.label} (data)`, points: series.points, color: "#495057", markers: true }];
    if (variable && variable.unit === series.unit) points.unshift({ label: "Model", points: modelPoints(model, run, series.variable), color: "#4c6ef5" });
    renderChart(box, { title: "", series: points, format: formatter(series.unit) });
  }
}
