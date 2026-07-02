import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as partsBinPlugins } from "./parts-bin";
import { plugins as deckPlugins } from "./deck";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    supportedDatatypes: ["embark-canvas"],
    async load() {
      const { EmbarkCanvasTool } = await import("./canvas");
      return EmbarkCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    async load() {
      const { EmbarkCanvasDatatype } = await import("./datatype");
      return EmbarkCanvasDatatype;
    },
  },
  ...partsBinPlugins,
  ...deckPlugins,
];
