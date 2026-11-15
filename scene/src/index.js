// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The `scene` tool is the stage (src/stage/stage.js): a scene with no UI of
// its own. Everything you see or do in it comes from `scene:extension`
// plugins, and the ones this package ships are below: the parts that together
// make the scene editor and the surfaces every scene has. See STAGE.md.

/**
 * The stage's time source (src/stage/time.js), loaded on asking: for a host
 * that runs the stage on a clock of its own (`element.time`), as the probes
 * do with `manualTime()`, stepping frames as fast as the CPU allows.
 */
export const loadTime = () => import("./stage/time.js");

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
    content: "file",
  },
  {
    type: "scene:source",
    id: "scene.link",
    name: "Linked scene",
    icon: "Link",
    supportedDatatypes: ["scene"],
    params: [],
    // A scene doc placed in another: a link (COMPOSITION.md §1). Its object
    // gets no render doc; the view opens a stage for the linked doc and
    // draws it where the link is (stage/links.js).
    content: "scene",
  },
  {
    type: "scene:source",
    id: "file-stl",
    name: "STL file",
    icon: "Box",
    supportedDatatypes: ["file"],
    extensions: ["stl"],
    content: "built",
    params: [
      { key: "unit", label: "File units", kind: "enum", default: "mm", options: SOURCE_UNITS, cost: "cheap" },
      { key: "up", label: "Up axis", kind: "enum", default: "z", options: UP_AXES, cost: "cheap" },
    ],
    async load() {
      return (await import("./sources/file-stl.js")).default;
    },
  },
  // ─── extensions: the parts the scene editor is made of ───
  // All but carry and others declare no traits ("general" scope): the view runs them
  // once, in the focus stage (the outermost doc until Enter moves the focus
  // into a link: COMPOSITION.md §3, §5), in this order, which is the order
  // input is offered to them, after every stage's own parts.
  // Carry runs by trait, where the doc has something carryable; others in
  // every doc (traits ["*"]), wherever the focus is. Chrome
  // follows attention, never the doc (TOOLS.md §1), and the editor's chrome
  // is the Edit body's (src/stage/bodies.js): the toolbar, the halo and its
  // knobs, the inspector (a drawer tab while something is selected), the
  // outline, dimensions and parts (tabs the viewer opens), the grid, axes
  // and bounds, and every command marked `edit: true` show only there.
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
    id: "scene.notices",
    name: "Notices",
    async load() {
      return (await import("./parts/notices.js")).default;
    },
  },
  // the packages this scene lists and this viewer doesn't have: one prompt to
  // load them (STAGE.md, "Packages")
  {
    type: "scene:extension",
    id: "scene.packages",
    name: "Packages",
    async load() {
      return (await import("./parts/packages.js")).default;
    },
  },
  {
    // the use prompt ("[F] Raise the anchor"): attention's verbs, shown
    // (scene.keys does them)
    type: "scene:extension",
    id: "scene.use",
    name: "Use prompt",
    async load() {
      return (await import("./parts/use.js")).default;
    },
  },
  {
    // the body chip, who's here and the Esc hint (TOOLS.md §4, §6)
    type: "scene:extension",
    id: "scene.body",
    name: "Body",
    async load() {
      return (await import("./parts/body.js")).default;
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
    // every target's verbs, Select first (TOOLS.md §3)
    type: "scene:extension",
    id: "scene.menu",
    name: "Context menu",
    async load() {
      return (await import("./parts/menu.js")).default;
    },
  },
  {
    // Enter a link: the focus, which scopes the selection, moves into it (COMPOSITION.md §5)
    type: "scene:extension",
    id: "scene.focus",
    name: "Enter",
    async load() {
      return (await import("./parts/focus.js")).default;
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
    // an untouched camera follows the content in as it loads
    type: "scene:extension",
    id: "scene.autoframe",
    name: "Frame on open",
    async load() {
      return (await import("./parts/autoframe.js")).default;
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
    id: "scene.measure",
    name: "Measure",
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
    // the selection's handles: move arrows, rotate rings and scale corners
    // outside its box, in its parent's frame (TOOLS.md §3). It follows the
    // selection
    type: "scene:extension",
    id: "scene.halo",
    name: "Halo",
    async load() {
      return (await import("./parts/halo.js")).default;
    },
  },
  {
    // carrying: whatever has the trait can be picked up and put down, in
    // any stage whose doc has something carryable (TOOLS.md §1). Not
    // general: the trait is its only reason to run.
    type: "scene:extension",
    id: "scene.carry",
    name: "Carry",
    traits: ["scene.carry"],
    describes: {
      "scene.carry": {
        name: "Carryable",
        on: "object",
        blurb: "Can be picked up and put down: drag it, Q / E to turn it, F to turn it over",
      },
    },
    async load() {
      return (await import("./parts/carry.js")).default;
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
    // the selection: Select is every menu's first entry, and the Edit
    // body's click (TOOLS.md §3)
    type: "scene:extension",
    id: "scene.select",
    name: "Selection",
    async load() {
      return (await import("./parts/select.js")).default;
    },
  },
  {
    // everyone else's selection boxes: a part of every doc, so they show
    // wherever their doc is drawn, whatever the focus (COMPOSITION.md §3,
    // "Presence where it is")
    type: "scene:extension",
    id: "scene.others",
    name: "Others' selections",
    traits: ["*"],
    async load() {
      return (await import("./parts/others.js")).default;
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
  // objects from another scene, or from this one: an outline row dragged
  // into this view, Copy and Paste (STAGE.md, "Copying objects")
  {
    type: "scene:extension",
    id: "scene.transfer",
    name: "Copy and paste",
    async load() {
      return (await import("./parts/transfer.js")).default;
    },
  },
  // the parts bin: every scene:part, to drag into the view or click to put
  // where you're looking: a drawer tab the viewer opens (Parts), offered
  // only when some package offers a part.
  {
    type: "scene:extension",
    id: "scene.parts",
    name: "Parts",
    async load() {
      return (await import("./parts/parts.js")).default;
    },
  },
  // the stage's own edits, undone and redone (TOOLS.md, Decisions 2): this
  // viewer's, in the focus doc
  {
    type: "scene:extension",
    id: "scene.undo",
    name: "Undo",
    async load() {
      return (await import("./parts/undo.js")).default;
    },
  },
  // the doc's world time: ▶ or ⏸, who paused it, a stall (only for a doc with a process)
  {
    type: "scene:extension",
    id: "scene.clock",
    name: "Clock",
    async load() {
      return (await import("./parts/clock.js")).default;
    },
  },
];
