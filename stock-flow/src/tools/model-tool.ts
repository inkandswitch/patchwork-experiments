import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { formatter, modelPoints, type ChartSpec, type Series } from "../charts/resolve.ts";
import { element, escapeHtml, renderChart } from "../charts/svg.ts";
import { cachedRun, orderedScenarios, scenarioSettings } from "../engine/scenarios.ts";
import { resolveParameters } from "../engine/simulate.ts";
import { formatParameter, formatVariable } from "../views/format.ts";
import { scenarioCard } from "../views/scenario-card.ts";
import { renderLoopsPage } from "./loops-page.ts";
import { currentSettings, initialState, isTweaked, resetTweaks, type Context, type Tab, type ViewState } from "./model-state.ts";
import { errorMessage, mount, onResize, resolving, watch } from "./shared.ts";
import { renderStockFlowPage } from "./stock-flow-page.ts";
import type { DataSource, Run, StockFlowModelDoc, VariableId } from "../types.ts";

export const ModelTool: ToolRender<StockFlowModelDoc> = (handle, element) => {
  const { root, unmount } = mount(element, "sf-model");
  const view = createModelView(root);
  const stop = watch(
    handle,
    resolving(element.repo, (model, error) => (model ? view.update(model) : view.fail(error ?? "Can't read the model"))),
  );
  return () => {
    stop();
    view.destroy();
    unmount();
  };
};

const TABS: [Tab, string][] = [
  ["loops", "Loops"],
  ["stock-flow", "Stock and flow"],
  ["run", "Run"],
  ["equations", "Equations"],
  ["parameters", "Parameters"],
  ["scenarios", "Scenarios"],
  ["data", "Data"],
  ["sources", "Sources"],
];

function createModelView(root: HTMLElement) {
  const state = initialState();
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
    fail(message: string) {
      body.replaceChildren(element("p", { class: "sf-error" }, message));
    },
    destroy: stopResize,
  };
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
    state.inputs = {};
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
  if (isTweaked(state)) {
    const reset = element("button", { title: "Back to the scenario as written" }, "Reset");
    reset.addEventListener("click", () => {
      resetTweaks(state);
      rerender();
    });
    bar.append(reset);
  }
  header.replaceChildren(element("h1", {}, model.title), ...(model.description ? [element("p", {}, model.description)] : []), bar);
}

const TAB_RENDERERS: Record<Tab, (body: HTMLElement, context: Context, tooltip: HTMLElement) => void> = {
  loops: renderLoopsPage,
  "stock-flow": renderStockFlowPage,
  run: renderRun,
  equations: renderEquations,
  parameters: renderParameters,
  scenarios: renderScenarios,
  data: renderData,
  sources: renderSources,
};

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
    table.innerHTML = `<thead><tr><th>Parameter</th><th>Value</th><th>Meaning</th><th>Source</th></tr></thead>`;
    const tbody = element("tbody");
    for (const [id, parameter] of entries) {
      const row = element("tr");
      const formula = "derived" in parameter ? `<br><code>= ${escapeHtml(parameter.derived)}</code>` : "";
      const delay = parameter.delay ? `<br><span class="sf-muted">${escapeHtml(parameter.delay.kind)} delay. ${escapeHtml(parameter.delay.shape)}</span>` : "";
      const unit = parameter.unit ? ` <span class="sf-muted">${escapeHtml(parameter.unit)}</span>` : "";
      row.innerHTML = `<td><code>${escapeHtml(id)}</code>${parameter.label !== id ? `<br><span class="sf-muted">${escapeHtml(parameter.label)}</span>` : ""}</td>
        <td class="num">${formatParameter(values[id], parameter.format)}${unit}</td><td>${escapeHtml(parameter.meaning)}${formula}${delay}</td>
        <td class="sf-source"><span class="sf-badge ${provenanceKind(parameter)}">${escapeHtml(provenanceKind(parameter))}</span> ${escapeHtml(sourceText(parameter))}${estimatedText(parameter)}</td>`;
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

/** Every data source once, with the series that come from it, then the parameters grouped by where their values come from. */
function renderSources(body: HTMLElement, { model }: Context): void {
  const bySource = new Map<string, { source: DataSource; series: string[] }>();
  for (const [id, series] of Object.entries(model.data)) {
    const key = `${series.source.publisher}|${series.source.title}|${series.source.table ?? ""}`;
    const entry = bySource.get(key) ?? { source: series.source, series: [] };
    entry.series.push(id);
    bySource.set(key, entry);
  }
  const data = element("table");
  data.innerHTML = `<thead><tr><th>Publisher</th><th>Table</th><th>Retrieved</th><th>How</th><th>Series</th></tr></thead>`;
  const dataBody = element("tbody");
  for (const { source, series } of [...bySource.values()].sort((a, b) => a.source.publisher.localeCompare(b.source.publisher))) {
    const row = element("tr");
    row.innerHTML = `<td>${escapeHtml(source.publisher)}</td>
      <td><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>${source.table ? `<br><code>${escapeHtml(source.table)}</code>` : ""}${source.location ? `<br><span class="sf-muted">${escapeHtml(source.location)}</span>` : ""}</td>
      <td>${escapeHtml(source.retrieved)}</td><td>${escapeHtml(source.method)}</td>
      <td>${series.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")}</td>`;
    dataBody.append(row);
  }
  data.append(dataBody);
  body.append(element("h2", {}, `Data: ${bySource.size} sources, ${Object.keys(model.data).length} series`), data);

  const kinds = new Map<string, [string, StockFlowModelDoc["parameters"][string]][]>();
  for (const entry of Object.entries(model.parameters)) {
    const kind = provenanceKind(entry[1]);
    kinds.set(kind, [...(kinds.get(kind) ?? []), entry]);
  }
  const order = ["estimated", "data", "literature", "assumption", "switch", "definition", "derived", "unsourced"];
  for (const kind of order) {
    const entries = kinds.get(kind);
    if (!entries) continue;
    const table = element("table");
    table.innerHTML = `<thead><tr><th>Parameter</th><th>Value</th><th>${kind === "estimated" ? "Estimation" : "Source"}</th></tr></thead>`;
    const tbody = element("tbody");
    for (const [id, parameter] of entries) {
      const row = element("tr");
      const value = "value" in parameter ? formatParameter(parameter.value, parameter.format) : `<code>= ${escapeHtml(parameter.derived)}</code>`;
      row.innerHTML = `<td><code>${escapeHtml(id)}</code><br><span class="sf-muted">${escapeHtml(parameter.label)}</span></td>
        <td class="num">${value}${parameter.unit ? ` <span class="sf-muted">${escapeHtml(parameter.unit)}</span>` : ""}</td>
        <td>${escapeHtml(sourceText(parameter))}${estimatedText(parameter)}</td>`;
      tbody.append(row);
    }
    table.append(tbody);
    body.append(element("h2", {}, `${PROVENANCE_TITLES[kind]} (${entries.length})`), table);
  }
}

const PROVENANCE_TITLES: Record<string, string> = {
  estimated: "Estimated from data",
  data: "Read off data",
  literature: "From the literature",
  assumption: "Assumptions, covered by sensitivity ranges",
  switch: "Switches",
  definition: "Definitions",
  derived: "Derived from other parameters",
  unsourced: "No source yet",
};

/** Where a parameter's value comes from, read from its `estimated` record or the first word of its source text. */
export function provenanceKind(parameter: StockFlowModelDoc["parameters"][string]): string {
  if (parameter.estimated) return "estimated";
  if (!parameter.source) return "derived" in parameter ? "derived" : "unsourced";
  if (typeof parameter.source !== "string") return "data";
  const first = parameter.source.split(/[\s:,]/)[0].toLowerCase();
  if (first.startsWith("estimat")) return "estimated";
  if (first.startsWith("data") || first.startsWith("approximate") || first.startsWith("census")) return "data";
  if (first.startsWith("literature")) return "literature";
  if (first.startsWith("assumption")) return "assumption";
  if (first.startsWith("switch")) return "switch";
  if (first.startsWith("definition")) return "definition";
  if (first.startsWith("derived")) return "derived";
  return "derived" in parameter ? "derived" : "assumption";
}

function sourceText(parameter: StockFlowModelDoc["parameters"][string]): string {
  const source = parameter.source;
  if (!source) return "";
  if (typeof source === "string") return source;
  return `${source.publisher}: ${source.title}${source.table ? ` (${source.table})` : ""}, ${source.method}, retrieved ${source.retrieved}.`;
}

function estimatedText(parameter: StockFlowModelDoc["parameters"][string]): string {
  const e = parameter.estimated;
  if (!e) return "";
  const range = e.range ? ` within ${e.range.min}–${e.range.max}` : "";
  return `<br><span class="sf-muted">Estimated against ${e.from.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")} over ${e.years[0]}–${e.years[1]}${range}. ${escapeHtml(e.method)}</span>`;
}

function renderData(body: HTMLElement, { model, run }: Context): void {
  const grid = element("div", { class: "sf-data" });
  body.append(grid);
  for (const [id, series] of Object.entries(model.data)) {
    const card = element("article", { class: "sf-series" });
    const variable = series.variable === undefined ? undefined : model.variables[series.variable];
    const source = series.source;
    const compared = series.variable === undefined ? "shown for reference, not compared with the model" : `compared with ${escapeHtml(variable?.label ?? series.variable)}`;
    card.innerHTML = `<h3>${escapeHtml(series.label)}</h3>
      <div class="sf-muted"><code>${escapeHtml(id)}</code> · ${escapeHtml(series.unit)} · ${compared}</div>
      <p><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.publisher)}: ${escapeHtml(source.title)}</a>${source.table ? ` (${escapeHtml(source.table)})` : ""}.
        ${escapeHtml(source.method)}, retrieved ${escapeHtml(source.retrieved)}.</p>
      <ul>${series.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
    const box = element("div", { class: "sf-chart-box" });
    box.style.height = "200px";
    card.append(box);
    grid.append(card);
    const points: Series[] = [{ label: `${series.label} (data)`, points: series.points, color: "#495057", markers: true }];
    if (series.variable !== undefined && variable && variable.unit === series.unit) points.unshift({ label: "Model", points: modelPoints(model, run, series.variable), color: "#4c6ef5" });
    renderChart(box, { title: "", series: points, format: formatter(series.unit) });
  }
}
