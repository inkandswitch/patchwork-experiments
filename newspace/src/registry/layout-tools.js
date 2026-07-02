import { NewspaceDatatype } from "../datatype.js";

export const layoutPlugins = [
  {
    type: "sketchy:layout", id: "canvas", name: "Canvas", icon: "PenTool",
    toolId: "sketchy", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy" }; },
  },
  {
    type: "sketchy:layout", id: "list", name: "List", icon: "List",
    toolId: "sketchy:list", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy:list" }; },
  },
  {
    type: "sketchy:layout", id: "grid", name: "Grid", icon: "LayoutGrid",
    toolId: "sketchy:grid", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy:grid" }; },
  },
  {
    type: "patchwork:tool", id: "sketchy:grid", name: "Grid", icon: "LayoutGrid",
    unlisted: true, supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return (await import("../grid-tool.jsx")).GridTool; },
  },
  {
    type: "sketchy:layout", id: "dock", name: "Dock", icon: "LayoutPanelLeft",
    toolId: "sketchy:dock", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy:dock" }; },
  },
  {
    type: "patchwork:tool", id: "sketchy:dock", name: "Dock", icon: "LayoutPanelLeft",
    unlisted: true, supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return (await import("../dock-tool.js")).DockTool; },
  },
  {
    type: "sketchy:flap", id: "parts", name: "Parts", icon: "Shapes", edge: "bottom",
    async load() { return (await import("../parts-bin.js")).mountPartsBin; },
  },
  {
    type: "patchwork:tool",
    id: "sketchy:list",
    name: "List",
    icon: "List",
    unlisted: true,
    supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() {
      return (await import("../list-tool.jsx")).ListTool;
    },
  },
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
