import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "search",
    name: "Search",
    icon: "Search",
    supportedDatatypes: ["search"],
    async load() {
      const { SearchBoxTool } = await import("./SearchBox");
      return SearchBoxTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "search",
    name: "Search",
    icon: "Search",
    async load() {
      const { SearchDatatype } = await import("./datatype");
      return SearchDatatype;
    },
  },
];
