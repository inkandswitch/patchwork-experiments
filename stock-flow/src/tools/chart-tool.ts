import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { chartSpec, formatter, type ChartLine } from "../charts/resolve.ts";
import { element, renderChart } from "../charts/svg.ts";
import { describeFit, fitStats } from "../engine/fit.ts";
import { errorMessage, mount, onResize, openDocument, watch, watchModel } from "./shared.ts";
import type { StockFlowChartDoc, StockFlowModelDoc } from "../types.ts";

/** A chart over a model, recomputed in the browser whenever the chart or its model changes. */
export const ChartTool: ToolRender<StockFlowChartDoc> = (handle, toolElement) => {
  const { root, unmount } = mount(toolElement, "sf-chart");
  let chart: StockFlowChartDoc | undefined;
  let model: StockFlowModelDoc | undefined;
  let problem: string | undefined;

  const render = () => {
    if (problem) return root.replaceChildren(element("p", { class: "sf-error" }, problem));
    if (!chart || !model) return root.replaceChildren(element("p", { class: "sf-muted" }, "Loading the model…"));
    const box = element("div", { class: "sf-chart-box" });
    const footer = element("footer");
    root.replaceChildren(box, footer);
    try {
      const { spec, lines } = chartSpec(model, { ...chart, data: chart.data ?? [] });
      renderChart(box, spec);
      if (chart.fit) box.after(fitReadout(model, chart, lines));
    } catch (error) {
      box.replaceChildren(element("p", { class: "sf-error" }, errorMessage(error)));
    }
    const open = element("button", { title: "Open the model this chart runs" }, model.title);
    open.addEventListener("click", () => openDocument(root, chart!.model));
    footer.append("Model:", open);
  };

  const follow = watchModel(
    toolElement.repo,
    () => chart?.model,
    (next, error) => {
      model = next;
      problem = error;
      render();
    },
  );
  const stop = watch(handle, (doc) => {
    chart = doc;
    follow.refresh();
    render();
  });
  const stopResize = onResize(root, render);
  return () => {
    stop();
    follow.stop();
    stopResize();
    unmount();
  };
};

/** Fit statistics for every data series on the chart, per model line, over the fit window or the chart's years. */
export function fitReadout(model: StockFlowModelDoc, chart: StockFlowChartDoc, lines: ChartLine[]): HTMLElement {
  const years = typeof chart.fit === "object" ? chart.fit.years : chart.years;
  const list = element("ul", { class: "sf-fit" });
  for (const id of chart.data ?? []) {
    for (const line of lines) {
      const stats = fitStats(model, line.run, id, years);
      const item = element("li");
      item.append(element("strong", {}, `${model.data[id].label}${lines.length > 1 ? ` · ${line.label}` : ""}`), ` ${describeFit(stats, formatter(model.data[id].unit))}`);
      list.append(item);
    }
  }
  if (!list.children.length) list.append(element("li", { class: "sf-muted" }, "Add a data series to see fit statistics"));
  else list.prepend(element("li", { class: "sf-muted" }, `Fit${years ? ` ${years[0]}–${years[1]}` : ""}; Theil's split: bias = wrong level, variation = wrong trend or amplitude, covariation = unsystematic`));
  return list;
}
