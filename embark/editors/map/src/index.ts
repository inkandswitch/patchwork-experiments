import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "map",
    name: "Map",
    icon: "Map",
    supportedDatatypes: ["map"],
    async load() {
      const { MapTool } = await import("./MapTool");
      return MapTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "map",
    name: "Map",
    icon: "Map",
    async load() {
      const { MapDatatype } = await import("./datatype");
      return MapDatatype;
    },
  },
];
