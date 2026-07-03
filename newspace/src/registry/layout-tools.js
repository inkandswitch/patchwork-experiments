import { NewspaceDatatype } from "../datatype.js";

// list / grid / dock / pad were unregistered 2026-07-02 pending the
// container-types rethink; their dormant source files were removed.
export const layoutPlugins = [
  {
    type: "sketchy:layout", id: "canvas", name: "Canvas", icon: "PenTool",
    toolId: "sketchy", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy" }; },
  },
  // (the "parts" sketchy:flap registration was removed 2026-07-02 — the parts
  // bin is now a bare sketchy:window seeded on the overlay; see parts-bin.js)
  {
    type: "patchwork:tool",
    id: "form",
    name: "Fields",
    icon: "TextCursorInput",
    supportedDatatypes: ["*"],
    unlisted: true,
    async load() {
      return (await import("../form-tool.jsx")).FormTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "sketch",
    name: "Sketch",
    icon: "PenTool",
    async load() {
      return NewspaceDatatype;
    },
  },
  {
    type: "patchwork:component",
    id: "sketchy",
    name: "Sketchy",
    icon: "PenTool",
    async load() {
      return (await import("../component.js")).SketchyComponent;
    },
  },
  {
    type: "patchwork:datatype",
    id: "sketchy:layer:top",
    name: "Sketchy top layer",
    icon: "Layers",
    unlisted: true,
    async load() {
      return {
        init(doc) { doc.floats = []; },
        getTitle() { return "Top layer"; },
        setTitle() {},
      };
    },
  },
];

export const sketchyToolPlugins = [
  // `sketchy` — the DEFAULT tool: the thin acquisition tool over the `sketchy`
  // patchwork:component (see src/tool.jsx for the dated decision note).
  {
    type: "patchwork:tool",
    id: "sketchy",
    name: "Sketchy",
    icon: "PenTool",
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { SketchyTool } = await import("../tool.jsx");
      return SketchyTool;
    },
  },
  {
    type: "patchwork:tool",
    id: "sketchy:pencil",
    name: "Pencil",
    icon: "Pencil",
    unlisted: true,
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { SketchpadTool } = await import("../tool.jsx");
      return SketchpadTool;
    },
  },
];
