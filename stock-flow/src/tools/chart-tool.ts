import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { chartSpec } from "../charts/resolve.ts";
import { element, renderChart } from "../charts/svg.ts";
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
      const { spec } = chartSpec(model, { ...chart, data: chart.data ?? [] });
      renderChart(box, spec);
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
