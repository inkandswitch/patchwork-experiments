// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The `scene` tool is the stage (src/stage/stage.js): a scene with no UI of
// its own. Everything you see or do in it comes from `scene:extension`
// plugins, and the ones this package ships are below: the parts that together
// make the scene editor (in the "edit" activity). See STAGE.md.

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
    // The source doc already is the GLB: its objects get no render doc
    // (renderUrl: null) and the scene shows the file directly, so there is
    // nothing to load or build (README.md, "`scene` — the composition").
    passthrough: true,
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
  // None declares traits, so each runs in every scene ("general" scope), in
  // this order, which is the order input is offered to them; those that say
  // `activities: ["edit"]` only while someone is editing. The key map and
  // notices serve every activity. The sidebar shows panels in running order:
  // Objects, Inspector, then Dimensions, so those two come before measure
  // (which brings dimensions in right after it); neither claims canvas input,
  // so being early changes nothing else. Parts comes last.
  {
    type: "scene:extension",
    id: "scene.toolbar",
    name: "Toolbar",
    activities: ["edit"],
    async load() {
      return (await import("./parts/toolbar.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.sidebar",
    name: "Side panel",
    activities: ["edit"],
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
  // the packages this scene lists and this viewer doesn't have: one prompt to
  // load them, in every activity (STAGE.md, "Packages")
  {
    type: "scene:extension",
    id: "scene.packages",
    name: "Packages",
    async load() {
      return (await import("./parts/packages.js")).default;
    },
  },
  {
    // the use prompt ("[F] Raise the anchor"): the first-person menu, in
    // play only. Not general: it runs only when a game requires it (listed
    // before scene.keys, so the prompt hears its keys first), and so never
    // makes a scene offer "play" on its own.
    type: "scene:extension",
    id: "scene.use",
    name: "Use prompt",
    general: false,
    activities: ["play"],
    async load() {
      return (await import("./parts/use.js")).default;
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
    activities: ["edit"],
    async load() {
      return (await import("./parts/menu.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.frame",
    name: "Frame",
    activities: ["edit"],
    async load() {
      return (await import("./parts/frame.js")).default;
    },
  },
  {
    // an untouched camera follows the content in as it loads; no verbs, so
    // a game can require it without the editor's framing keys
    type: "scene:extension",
    id: "scene.autoframe",
    name: "Frame on open",
    activities: ["edit"],
    async load() {
      return (await import("./parts/autoframe.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.outline",
    name: "Objects",
    activities: ["edit"],
    async load() {
      return (await import("./parts/outline.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.inspector",
    name: "Inspector",
    activities: ["edit"],
    async load() {
      return (await import("./parts/inspector.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.measure",
    name: "Measure",
    activities: ["edit"],
    requires: ["scene.dimensions"],
    async load() {
      return (await import("./parts/measure.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.handles",
    name: "Handles",
    activities: ["edit"],
    async load() {
      return (await import("./parts/handles.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.gizmo",
    name: "Transform gizmo",
    activities: ["edit"],
    async load() {
      return (await import("./parts/gizmo.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.hand",
    name: "Hand",
    activities: ["edit"],
    async load() {
      return (await import("./parts/hand.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.dimensions",
    name: "Dimensions",
    activities: ["edit"],
    async load() {
      return (await import("./parts/dimensions.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.select",
    name: "Selection",
    activities: ["edit"],
    async load() {
      return (await import("./parts/select.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.grid",
    name: "Grid",
    activities: ["edit"],
    async load() {
      return (await import("./parts/grid.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.axes",
    name: "Axes",
    activities: ["edit"],
    async load() {
      return (await import("./parts/axes.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.bounds",
    name: "Bounds",
    activities: ["edit"],
    async load() {
      return (await import("./parts/bounds.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.units",
    name: "Units",
    activities: ["edit"],
    async load() {
      return (await import("./parts/units.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.legends",
    name: "Legends",
    activities: ["edit"],
    async load() {
      return (await import("./parts/legends.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "scene.add",
    name: "Add documents",
    activities: ["edit"],
    async load() {
      return (await import("./parts/add.js")).default;
    },
  },
  // objects from another scene, or from this one: an outline row dragged
  // into this view, Copy and Paste (STAGE.md, "Copying objects")
  {
    type: "scene:extension",
    id: "scene.transfer",
    name: "Copy and paste",
    activities: ["edit"],
    async load() {
      return (await import("./parts/transfer.js")).default;
    },
  },
  // the parts bin: every scene:part, to drag into the view or click to put
  // where you're looking. Its panel comes last in the sidebar (Objects,
  // Inspector, Dimensions, Parts), and only when some package offers a part.
  {
    type: "scene:extension",
    id: "scene.parts",
    name: "Parts",
    activities: ["edit"],
    async load() {
      return (await import("./parts/parts.js")).default;
    },
  },
  // seats: the places people take at a scene, the seat picker, and who sits
  // where for whoever needs to know (src/parts/seats.js; STAGE.md, "Seats").
  // A shared part: it runs wherever the scene has seats, in every activity
  // (who sits where decides who may see what, while editing too). `roster`
  // says its module can write seats into a scene being set up (`lay`).
  {
    type: "scene:extension",
    id: "scene.seats",
    name: "Seats",
    traits: ["scene.seats"],
    roster: true,
    describes: {
      "scene.seats": {
        name: "Seats",
        on: "scene",
        blurb: "The places people take here: pick one to sit in it",
        entries: { label: "Seats", noun: "seat", prefix: "seat", fields: [{ key: "name", label: "Name", kind: "string", default: "Seat" }], init: { player: null } },
      },
    },
    async load() {
      return (await import("./parts/seats.js")).default;
    },
  },
  // what this viewer is doing, and switching it (only shown when there's a choice)
  {
    type: "scene:extension",
    id: "scene.activity",
    name: "Activity",
    always: true,
    async load() {
      return (await import("./parts/activity.js")).default;
    },
  },
];
