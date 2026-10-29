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
];
