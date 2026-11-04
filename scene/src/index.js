// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.

const SOURCE_UNITS = [
  { value: "mm", label: "Millimetres" },
  { value: "cm", label: "Centimetres" },
  { value: "m", label: "Metres" },
  { value: "in", label: "Inches" },
];

const UP_AXES = [
  { value: "z", label: "Z up (CAD, printers)" },
  { value: "y", label: "Y up" },
];

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "scene",
    name: "Scene",
    icon: "Box",
    async load() {
      return (await import("./datatype.js")).SceneDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "scene-render",
    name: "Scene render",
    icon: "Box",
    unlisted: true,
    async load() {
      return (await import("./datatype.js")).SceneRenderDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "scene",
    name: "Scene",
    icon: "Box",
    supportedDatatypes: ["scene"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "patchwork:tool",
    id: "scene-render-controls",
    name: "Render controls",
    icon: "SlidersHorizontal",
    supportedDatatypes: ["scene-render"],
    async load() {
      return (await import("./controls-tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "file-glb",
    name: "GLB file",
    icon: "Box",
    supportedDatatypes: ["file"],
    extensions: ["glb"],
    params: [],
    // SCENE-CONTRACT v3 §6: the source doc already is the GLB. New objects get
    // no render doc (renderUrl: null) and the scene shows the file directly;
    // load() is only used by objects added before v3 (they have a renderUrl).
    passthrough: true,
    async load() {
      return (await import("./sources/file-glb.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "file-stl",
    name: "STL file",
    icon: "Box",
    supportedDatatypes: ["file"],
    extensions: ["stl"],
    params: [
      { key: "unit", label: "File units", kind: "enum", default: "mm", options: SOURCE_UNITS, cost: "cheap" },
      { key: "up", label: "Up axis", kind: "enum", default: "z", options: UP_AXES, cost: "cheap" },
    ],
    async load() {
      return (await import("./sources/file-stl.js")).default;
    },
  },
];
