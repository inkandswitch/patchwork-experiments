import { PaperMapDatatype } from "./datatype";

// The map is an example embeddable document: its own datatype plus a tool that
// renders it with MapLibre. It is what newly created paper docs embed by
// default.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "paper-map",
    name: "Map",
    icon: "Map",
    async load() {
      return PaperMapDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "paper-map",
    name: "Map",
    icon: "Map",
    supportedDatatypes: ["paper-map"],
    async load() {
      const { MapTool } = await import("./MapTool");
      return MapTool;
    },
  },
];
