export { createRef, findRef, parseRefURL } from "./ref";
export { registerRefView } from "./ref-view";
export { createFilesystem } from "./filesystem";
export type { PaperFilesystem } from "./filesystem";
export type { Ref, RefPathSegment } from "./ref";
export type { Schema } from "./schema";
export type { RefViewHostElement } from "./ref-view";

export type PaperDoc = {
  title: string;
  frameDocUrl: string;
  sourceFolderUrl: string;
};

export const plugins = [
  {
    type: "patchwork:tool",
    id: "surface",
    name: "Surface",
    supportedDatatypes: ["surface"],
    async load() {
      const { PaperTool } = await import("./tool");
      return PaperTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "surface",
    name: "Surface",
    icon: "LayoutTemplate",
    async load() {
      const { PaperDatatype } = await import("./datatype");
      return PaperDatatype;
    },
  },
];
