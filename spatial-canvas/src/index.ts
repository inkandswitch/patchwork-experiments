import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "./core/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { CanvasView } from "./core/canvas.js";
import { rectanglePlugins } from "./rectangle/rectangle.js";

export type { CanvasDoc, CanvasShape } from "./core/types.js";

// ============================================================================
// Spatial Canvas Datatype
// ============================================================================

export const SpatialCanvasDatatype = {
  init(doc: CanvasDoc) {
    doc.shapes = {};
    doc.stateByUser = {};
    doc.layout = {
      "spatial-canvas-panel-toolbar":    { kind: "panel", position: ["bottom", "center"] },
      "spatial-canvas-panel-properties": { kind: "panel", position: ["top",    "left"  ] },
      "spatial-canvas-panel-build":      { kind: "panel", position: ["top",    "right"  ] },
    };
  },

  getTitle(_doc: CanvasDoc): string {
    return "Spatial Canvas";
  },

  markCopy(_doc: CanvasDoc) {},
};

// ============================================================================
// Spatial Canvas Tool
// ============================================================================

export function Tool(handle: DocHandle<CanvasDoc>, element: PatchworkViewElement): Disposer {
  const view = new CanvasView(handle, element);
  return () => view.dispose();
}

// ============================================================================
// Plugin exports
// ============================================================================

export const plugins = [
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
      return Tool;
    },
  },
  ...rectanglePlugins,
  // -------------------------------------------------------------------------
  // Canvas tools (tag: spatial-canvas-tool)
  // -------------------------------------------------------------------------
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-place-rectangle",
    name: "Rectangle",
    icon: "Square",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./rectangle/place-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-pen",
    name: "Pen",
    icon: "Pen",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./pen/pen-tool.js")).PenTool;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-select",
    name: "Select",
    icon: "MousePointer",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./select/select-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-delete",
    name: "Delete",
    icon: "Eraser",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./delete/delete-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-text",
    name: "Text",
    icon: "Type",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./text/place-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-embed",
    name: "Embed",
    icon: "Layers",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./embed/place-tool.js")).default;
    },
  },
  // -------------------------------------------------------------------------
  // Render layers (tag: spatial-canvas-layer)
  // -------------------------------------------------------------------------
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-rectangles",
    name: "Rectangle Layer",
    icon: "Square",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./rectangle/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-pen",
    name: "Pen Layer",
    icon: "Pen",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./pen/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-selection",
    name: "Selection Layer",
    icon: "MousePointer",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./select/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-text",
    name: "Text Layer",
    icon: "Type",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./text/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-embed",
    name: "Embed Layer",
    icon: "Layers",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./embed/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-resize",
    name: "Resize Layer",
    icon: "Maximize2",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./resize/layer.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-drop",
    name: "Drop Layer",
    icon: "Download",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./drop/layer.js")).default;
    },
  },
  // -------------------------------------------------------------------------
  // Panels (tag: spatial-canvas-panel)
  // -------------------------------------------------------------------------
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-toolbar",
    name: "Toolbar",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./core/toolbar.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-properties",
    name: "Properties",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./properties/panel.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-build",
    name: "Build",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./build/panel.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "process",
    name: "Process",
    unlisted: true,
    supportedDatatypes: [],
    async load() {
      return (await import("./build/process-viewer.js")).default;
    },
  },
];
