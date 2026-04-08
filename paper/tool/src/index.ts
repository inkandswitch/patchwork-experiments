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
    id: "paper",
    name: "Paper",
    supportedDatatypes: ["paper"],
    async load() {
      const { PaperTool } = await import("./tool");
      return PaperTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "paper",
    name: "Paper",
    icon: "LayoutTemplate",
    async load() {
      const { PaperDatatype } = await import("./datatype");
      return PaperDatatype;
    },
  },
];
