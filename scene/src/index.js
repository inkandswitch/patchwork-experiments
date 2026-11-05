// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The `scene` tool is the stage (src/stage/stage.js): a scene with no UI of
// its own. Everything you see or do in it comes from `scene:extension`
// plugins, and the ones this package ships are below; the "model" kit is
// those that together make the scene editor. See STAGE.md.

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
      return (await import("./stage/stage.js")).default;
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
  // ─── extensions: the parts the scene editor is made of ───
  {
    type: "scene:extension",
    id: "scene.toolbar",
    name: "Toolbar",
    async load() {
      return (await import("./parts/toolbar.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.sidebar",
    name: "Side panel",
    async load() {
      return (await import("./parts/sidebar.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.notices",
    name: "Notices",
    async load() {
      return (await import("./parts/notices.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.keys",
    name: "Keyboard shortcuts",
    async load() {
      return (await import("./parts/keys.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.menu",
    name: "Context menu",
    async load() {
      return (await import("./parts/menu.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.frame",
    name: "Frame",
    async load() {
      return (await import("./parts/frame.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.measure",
    name: "Measure",
    requires: ["scene.dimensions"],
    async load() {
      return (await import("./parts/measure.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.handles",
    name: "Handles",
    async load() {
      return (await import("./parts/handles.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.gizmo",
    name: "Transform gizmo",
    async load() {
      return (await import("./parts/gizmo.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.hand",
    name: "Hand",
    async load() {
      return (await import("./parts/hand.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.dimensions",
    name: "Dimensions",
    async load() {
      return (await import("./parts/dimensions.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.select",
    name: "Selection",
    async load() {
      return (await import("./parts/select.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.outline",
    name: "Objects",
    async load() {
      return (await import("./parts/outline.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.inspector",
    name: "Inspector",
    async load() {
      return (await import("./parts/inspector.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.grid",
    name: "Grid",
    async load() {
      return (await import("./parts/grid.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.axes",
    name: "Axes",
    async load() {
      return (await import("./parts/axes.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.bounds",
    name: "Bounds",
    async load() {
      return (await import("./parts/bounds.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.units",
    name: "Units",
    async load() {
      return (await import("./parts/units.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.legends",
    name: "Legends",
    async load() {
      return (await import("./parts/legends.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.add",
    name: "Add documents",
    async load() {
      return (await import("./parts/add.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.kits",
    name: "Kits",
    always: true,
    async load() {
      return (await import("./parts/kits.js")).default;
    },
  },
  // the scene editor: in this order, which is the order input is offered in
  {
    type: "scene:kit",
    id: "model",
    name: "Model",
    icon: "Box",
    extensions: [
      "scene.toolbar",
      "scene.sidebar",
      "scene.notices",
      "scene.keys",
      "scene.menu",
      "scene.frame",
      // The sidebar shows panels in running order: Objects, Inspector, then
      // Dimensions, as the old tool had them. So these two come before
      // measure (which brings dimensions in right after it). Neither claims
      // canvas input, so being early changes nothing else.
      "scene.outline",
      "scene.inspector",
      "scene.measure",
      "scene.handles",
      "scene.gizmo",
      "scene.hand",
      "scene.dimensions",
      "scene.select",
      "scene.grid",
      "scene.axes",
      "scene.bounds",
      "scene.units",
      "scene.legends",
      "scene.add",
    ],
  },
];
