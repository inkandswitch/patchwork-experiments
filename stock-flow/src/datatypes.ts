import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type {
  StockFlowAttributionDoc,
  StockFlowChartDoc,
  StockFlowModelDoc,
  StockFlowScenarioDoc,
  StockFlowSensitivityDoc,
  StockFlowTestsDoc,
} from "./types.ts";

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

export const TestsDatatype: DatatypeImplementation<StockFlowTestsDoc> = {
  init(doc) {
    Object.assign(doc, { "@patchwork": { type: "stock-flow-tests" }, title: "", scenario: "", tests: [] });
  },
  getTitle: (doc) => doc.title || "Model tests",
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const SensitivityDatatype: DatatypeImplementation<StockFlowSensitivityDoc> = {
  init(doc) {
    Object.assign(doc, { "@patchwork": { type: "stock-flow-sensitivity" }, title: "", scenario: "", parameters: {}, method: { kind: "one-at-a-time" }, outcomes: [] });
  },
  getTitle: (doc) => doc.title || "Sensitivity",
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const AttributionDatatype: DatatypeImplementation<StockFlowAttributionDoc> = {
  init(doc) {
    Object.assign(doc, { "@patchwork": { type: "stock-flow-attribution" }, title: "", scenario: "", drivers: {} });
  },
  getTitle: (doc) => doc.title || "Attribution",
  setTitle(doc, title) {
    doc.title = title;
  },
};
