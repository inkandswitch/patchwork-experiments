import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "datalog",
    name: "Datalog",
    supportedDatatypes: ["datalog"],
    async load() {
      const { DatalogTool } = await import("./tool");
      return DatalogTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "datalog",
    name: "Datalog",
    icon: "Zap",
    async load() {
      const { DatalogDatatype } = await import("./datatype");
      return DatalogDatatype;
    },
  },
];

console.log("datalogversion 2");
