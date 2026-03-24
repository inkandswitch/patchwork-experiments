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
    id: "surface",
    name: "Surface",
    supportedDatatypes: ["surface"],
    async load() {
      const { SurfaceTool } = await import("./tool");
      return SurfaceTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "surface",
    name: "Surface",
    icon: "LayoutTemplate",
    async load() {
      const { SurfaceDatatype } = await import("./datatype");
      return SurfaceDatatype;
    },
  },
];
