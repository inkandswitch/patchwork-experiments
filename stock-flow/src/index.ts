import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "stock-flow-model",
    name: "Stock and Flow Model",
    icon: "Waves",
    async load() {
      return (await import("./datatypes.ts")).ModelDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-chart",
    name: "Stock and Flow Chart",
    icon: "ChartLine",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).ChartDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-scenario",
    name: "Stock and Flow Scenario",
    icon: "FlaskConical",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).ScenarioDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-tests",
    name: "Stock and Flow Tests",
    icon: "ClipboardCheck",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).TestsDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-sensitivity",
    name: "Stock and Flow Sensitivity",
    icon: "SlidersHorizontal",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).SensitivityDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-attribution",
    name: "Stock and Flow Attribution",
    icon: "ChartBarBig",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).AttributionDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-table",
    name: "Stock and Flow Table",
    icon: "Table",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).TableDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "stock-flow-fit",
    name: "Stock and Flow Fit Run",
    icon: "Target",
    unlisted: true,
    async load() {
      return (await import("./datatypes.ts")).FitDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "stock-flow-table",
    name: "Table",
    icon: "Table",
    supportedDatatypes: ["stock-flow-table"],
    async load() {
      return (await import("./tools/table-tool.ts")).TableTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-fit",
    name: "Fit run",
    icon: "Target",
    supportedDatatypes: ["stock-flow-fit"],
    async load() {
      return (await import("./tools/fit-tool.ts")).FitTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-model",
    name: "Stock and Flow Model",
    icon: "Waves",
    supportedDatatypes: ["stock-flow-model"],
    async load() {
      return (await import("./tools/model-tool.ts")).ModelTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-chart",
    name: "Chart",
    icon: "ChartLine",
    supportedDatatypes: ["stock-flow-chart"],
    async load() {
      return (await import("./tools/chart-tool.ts")).ChartTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-scenario",
    name: "Scenario",
    icon: "FlaskConical",
    supportedDatatypes: ["stock-flow-scenario"],
    async load() {
      return (await import("./tools/scenario-tool.ts")).ScenarioTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-tests",
    name: "Tests",
    icon: "ClipboardCheck",
    supportedDatatypes: ["stock-flow-tests"],
    async load() {
      return (await import("./tools/tests-tool.ts")).TestsTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-sensitivity",
    name: "Sensitivity",
    icon: "SlidersHorizontal",
    supportedDatatypes: ["stock-flow-sensitivity"],
    async load() {
      return (await import("./tools/sensitivity-tool.ts")).SensitivityTool;
    },
  } as Tool,
  {
    type: "patchwork:tool",
    id: "stock-flow-attribution",
    name: "Attribution",
    icon: "ChartBarBig",
    supportedDatatypes: ["stock-flow-attribution"],
    async load() {
      return (await import("./tools/attribution-tool.ts")).AttributionTool;
    },
  } as Tool,
];
