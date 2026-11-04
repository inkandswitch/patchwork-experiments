import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { element, renderChart } from "../charts/svg.ts";
import { describeFit } from "../engine/fit.ts";
import { parseRef } from "../engine/links.ts";
import { annotationList } from "../views/annotations.ts";
import { errorMessage, mount, onResize, openDocument, watch } from "./shared.ts";
import type { FitComparison, StockFlowFitDoc } from "../types.ts";

/** A fit run as recorded: the values and their bounds, every start, the fit of each comparison, and the profiles. */
export const FitTool: ToolRender<StockFlowFitDoc> = (handle, toolElement) => {
  const { root, unmount } = mount(toolElement, "sf-linked");
  let fit: StockFlowFitDoc | undefined;
  const render = () => {
    if (!fit) return;
    try {
      renderFit(root, fit);
    } catch (error) {
      root.replaceChildren(element("p", { class: "sf-error" }, errorMessage(error)));
    }
  };
  const stop = watch(handle, (doc) => {
    fit = doc;
    render();
  });
  const stopResize = onResize(root, render);
  return () => {
    stop();
    stopResize();
    unmount();
  };
};

function renderFit(root: HTMLElement, fit: StockFlowFitDoc): void {
  const header = element("header");
  const span = `fit ${fit.objective.years.join("–")}${fit.holdout ? `, holdout ${fit.holdout.years.join("–")}` : ", no holdout"}`;
  header.append(element("h1", {}, fit.title), element("p", { class: "sf-muted" }, `Scenario ${fit.scenario} · ${span} · ${fit.run.at.slice(0, 16).replace("T", " ")} · ${fit.run.version}`));
  const charts = fit.comparisons.map(() => element("div", { class: "sf-chart-box" }));
  const comparisons = element("div");
  fit.comparisons.forEach((comparison, index) => comparisons.append(element("h3", {}, comparisonTitle(fit, comparison)), statsLine(comparison), charts[index]));
  root.replaceChildren(
    header,
    element("h2", {}, "Values"),
    valuesTable(fit),
    element("h2", {}, `Starts (${fit.restarts.length}): do they end in the same place?`),
    restartsTable(fit),
    element("h2", {}, "Comparisons"),
    comparisons,
    ...(fit.profiles ? [element("h2", {}, "Profiles: a flat profile means the data don't pin the parameter down"), profilesView(fit)] : []),
    element("h2", {}, "Run"),
    runView(root, fit),
    element("h2", {}, "Annotations"),
    annotationList(fit.annotations),
  );
  fit.comparisons.forEach((comparison, index) => {
    const data = comparison.residuals.map(({ year, data }): [number, number] => [year, data]);
    const model = comparison.residuals.map(({ year, model }): [number, number] => [year, model]);
    renderChart(charts[index], {
      title: "",
      series: [
        { label: "Data", points: data, color: "#495057", markers: true, dashed: true },
        { label: "Model", points: model, color: "#1c7ed6" },
      ],
      format: (value) => value.toLocaleString("en", { maximumSignificantDigits: 4 }),
    });
  });
}

function valuesTable(fit: StockFlowFitDoc): HTMLElement {
  const grid = element("table");
  const head = element("tr");
  for (const column of ["parameter", "value", "bounds", ""]) head.append(element("th", {}, column));
  grid.append(head);
  for (const [id, value] of Object.entries(fit.values)) {
    const row = element("tr");
    const bounds = fit.bounds[id];
    row.append(element("td", {}, id), element("td", {}, String(value)), element("td", {}, bounds ? `${bounds.min}–${bounds.max}` : ""), element("td", { class: fit.atBound.includes(id) ? "sf-error" : "sf-muted" }, fit.atBound.includes(id) ? "at a bound" : ""));
    grid.append(row);
  }
  return grid;
}

function restartsTable(fit: StockFlowFitDoc): HTMLElement {
  const ids = Object.keys(fit.values);
  const grid = element("table");
  const head = element("tr");
  for (const column of ["objective", ...ids.map((id) => `${id} start → end`)]) head.append(element("th", {}, column));
  grid.append(head);
  for (const restart of [...fit.restarts].sort((a, b) => a.objective - b.objective)) {
    const row = element("tr");
    row.append(element("td", {}, restart.objective.toPrecision(4)));
    for (const id of ids) row.append(element("td", {}, `${restart.start[id]} → ${restart.end[id]}`));
    grid.append(row);
  }
  return grid;
}

function comparisonTitle(fit: StockFlowFitDoc, comparison: FitComparison): string {
  const weight = fit.objective.compare[comparison.compare];
  return `${comparison.compare}${weight !== 1 ? ` (weight ${weight})` : ""}${fit.models.length > 1 ? ` · model ${fit.models.indexOf(comparison.model) + 1}` : ""}`;
}

function statsLine(comparison: FitComparison): HTMLElement {
  const line = element("p", { class: "sf-muted" }, `In sample: ${describeFit(comparison.inSample)}`);
  if (comparison.holdout) line.append(element("br"), `Holdout: ${describeFit(comparison.holdout)}`);
  return line;
}

function profilesView(fit: StockFlowFitDoc): HTMLElement {
  const box = element("div", { class: "sf-profiles" });
  for (const [id, points] of Object.entries(fit.profiles ?? {})) {
    const lowest = Math.min(...points.map((point) => point.objective));
    const highest = Math.max(...points.map((point) => point.objective));
    const grid = element("table");
    grid.append(element("caption", {}, id));
    for (const { value, objective } of points) {
      const row = element("tr");
      const bar = element("div", { class: "sf-bar" });
      bar.style.width = `${highest > lowest ? 4 + (96 * (objective - lowest)) / (highest - lowest) : 4}%`;
      const cell = element("td", { class: "sf-bar-cell" });
      cell.append(bar);
      row.append(element("td", {}, String(value)), element("td", {}, objective.toPrecision(4)), cell);
      grid.append(row);
    }
    box.append(grid);
  }
  return box;
}

function runView(root: HTMLElement, fit: StockFlowFitDoc): HTMLElement {
  const box = element("div");
  const command = element("pre", { class: "sf-query" });
  command.append(element("code", {}, fit.run.command));
  const models = element("ul", { class: "sf-inputs" });
  for (const url of fit.models) {
    const item = element("li");
    const open = element("button", { title: url }, "Model");
    open.addEventListener("click", () => openDocument(root, `automerge:${parseRef(url).documentId}`));
    item.append(open, element("span", { class: "sf-muted" }, parseRef(url).heads ? " at the version that was fitted" : " (not pinned)"));
    models.append(item);
  }
  box.append(
    command,
    element("p", { class: "sf-muted" }, `Nelder–Mead from ${fit.method.starts} starts (seed ${fit.method.seed}), up to ${fit.method.maxEvaluations} evaluations each; objective ${fit.objectiveValue.toPrecision(4)}`),
    models,
  );
  return box;
}
