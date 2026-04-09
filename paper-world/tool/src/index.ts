export { createRef, findRef, parseRefURL } from "./ref";
export { registerRefView } from "./ref-view";
export { createFilesystem } from "./filesystem";
export { createPluginRegistry } from "./plugins";
export type { Filesystem } from "./filesystem";
export type { Ref, RefPathSegment } from "./ref";
export type { Schema } from "./schema";
export type { Subscribable } from "./subscribable";
export type { Plugin, PluginRegistry } from "./plugins";
export type { RefViewHostElement } from "./ref-view";

export const plugins = [
  {
    type: "patchwork:tool",
    id: "paper-world",
    name: "Paper World",
    supportedDatatypes: ["paper-world"],
    async load() {
      const { PaperWorldTool } = await import("./tool");
      return PaperWorldTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "paper-world",
    name: "Paper World",
    icon: "LayoutTemplate",
    async load() {
      const { PaperWorldDatatype } = await import("./datatype");
      return PaperWorldDatatype;
    },
  },
];
