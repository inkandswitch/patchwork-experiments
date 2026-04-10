import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { loadCustomHighlights } from "./codemirror-highlights";

export const plugins: Plugin<any>[] = [
  {
    type: "codemirror:extension",
    id: "datalog-attribution-highlights",
    name: "Datalog Attribution Highlights",
    supportedDatatypes: "*",
    async load() {
      return loadCustomHighlights();
    },
  },
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
