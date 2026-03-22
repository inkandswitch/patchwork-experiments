export { createRef, findRef, encodeRefToURL, parseRefURL } from "./ref";
export { registerRefView } from "./ref-view";
export { createFilesystem } from "./filesystem";
export type { MiniCanvasFilesystem } from "./filesystem";
export type { Ref, RefPathSegment, Schema } from "./ref";
export type { RefViewHostElement } from "./ref-view";

export type MiniCanvasDoc = {
  title: string;
  frameDocUrl: string;
  sourceFolderUrl: string;
};

export const plugins = [
  {
    type: "patchwork:tool",
    id: "mini-canvas",
    name: "Mini Canvas",
    supportedDatatypes: ["mini-canvas"],
    async load() {
      const { MiniCanvasTool } = await import("./tool");
      return MiniCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "mini-canvas",
    name: "Mini Canvas",
    icon: "LayoutTemplate",
    async load() {
      const { MiniCanvasDatatype } = await import("./datatype");
      return MiniCanvasDatatype;
    },
  },
];
