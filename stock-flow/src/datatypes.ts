import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { StockFlowChartDoc, StockFlowModelDoc, StockFlowScenarioDoc } from "./types.ts";

export const ModelDatatype: DatatypeImplementation<StockFlowModelDoc> = {
  init(doc) {
    Object.assign(doc, {
      "@patchwork": { type: "stock-flow-model" },
      title: "Untitled model",
      description: "",
      simulation: { startYear: 0, years: 10, dt: 1 / 16, recordInterval: 0.25 },
      variables: {},
      parameters: {},
      data: {},
      scenarios: {},
      annotations: { loops: {}, links: {} },
    });
  },
  getTitle: (doc) => doc.title || "Untitled model",
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const ChartDatatype: DatatypeImplementation<StockFlowChartDoc> = {
  init(doc) {
    Object.assign(doc, { "@patchwork": { type: "stock-flow-chart" }, title: "", scenarios: [], series: [], data: [] });
  },
  getTitle: (doc) => doc.title || "Chart",
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const ScenarioDatatype: DatatypeImplementation<StockFlowScenarioDoc> = {
  init(doc) {
    Object.assign(doc, { "@patchwork": { type: "stock-flow-scenario" }, scenario: "" });
  },
  getTitle: (doc) => (doc.scenario ? `Scenario ${doc.scenario}` : "Scenario"),
};
