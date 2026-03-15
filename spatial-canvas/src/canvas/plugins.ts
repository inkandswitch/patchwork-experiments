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
      return (await import("./canvas.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-toolbar",
    name: "Toolbar",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./toolbar.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-keyboard",
    name: "Keyboard Shortcuts",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./keyboard-panel.js")).default;
    },
  },
];
