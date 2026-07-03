import { NewspaceDatatype } from "../datatype.js";

export const coreToolPlugins = [
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
