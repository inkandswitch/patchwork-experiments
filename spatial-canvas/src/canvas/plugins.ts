import type { CanvasDoc } from "./types.js";

const SpatialCanvasDatatype = {
  init(doc: CanvasDoc) {
    doc.shapes = {};
    doc.stateByUser = {};
    doc.layout = {
      "spatial-canvas-panel-toolbar": { kind: "panel", position: ["bottom", "center"] },
      "spatial-canvas-panel-properties": { kind: "panel", position: ["top", "left"] },
      "spatial-canvas-panel-build": { kind: "panel", position: ["top", "right"] },
      "spatial-canvas-panel-keyboard": { kind: "panel", position: ["bottom", "center"] },
    };
  },

  getTitle(_doc: CanvasDoc): string {
    return "Spatial Canvas";
  },

  markCopy(_doc: CanvasDoc) {},
};

export const canvasPlugins = [
  {
    type: "patchwork:datatype" as const,
    id: "spatial-canvas",
    name: "Spatial Canvas",
    icon: "Globe",
    async load() {
      return SpatialCanvasDatatype;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas",
    name: "Spatial Canvas",
    icon: "Globe",
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./layout.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-view",
    name: "Spatial Canvas View",
    unlisted: true,
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./view.js")).default;
    },
  },
];
