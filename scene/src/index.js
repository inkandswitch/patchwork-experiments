// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// The `scene` tool is the stage (src/stage/stage.js): a scene with no UI of
// its own. Everything you see or do in it comes from `scene:extension`
// plugins: `scene:extension`s, which run in a stage for a doc's traits, and
// `scene:view`s, which run once per view whatever the focus. The ones this
// package ships are below: the parts that together make the scene editor and
// the surfaces every scene has. See STAGE.md.

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
    // A scene doc placed in another: a link (STAGE.md, "Views, stages and links"). Its object
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
  // ─── the parts the scene editor is made of ───
  // The native services (STAGE.md, "Native services"): parts of every doc, or
  // view plugins, started before what doesn't provide (their `provides`, and `uses`).
  ...[
    ["claims", "Claims", { provides: ["claims"] }, () => import("./native/claims.js")],
    ["clock", "World time", { provides: ["clock"], uses: ["claims"] }, () => import("./native/clock.js")],
    ["telling", "Telling", { provides: ["tell"] }, () => import("./native/telling.js")],
    ["notices", "Notices", { provides: ["notices"] }, () => import("./native/notices.js"), "scene:view"],
    ["prefs", "Prefs", { provides: ["prefs"] }, () => import("./native/prefs.js"), "scene:view"],
    ["drawer", "Drawer", { provides: ["drawer"], uses: ["prefs"] }, () => import("./native/drawer.js"), "scene:view"],
  ].map(([n, name, services, load, type = "scene:extension"]) => ({ type, id: `scene.${n}`, name, ...(type === "scene:view" ? {} : { traits: ["*"] }), ...services, load: async () => (await load()).default })),
  // All but carry and others are view plugins (STAGE.md, "View plugins"):
  // each runs once per view, for its whole life, and works on the focus
  // stage through api.focus() (the outermost doc until Enter moves the focus
  // into a link); in this order, which is the order input is offered to
  // them, after every stage's own extensions.
  // Carry runs by trait, where the doc has something carryable; others in
  // every doc (traits ["*"]), wherever the focus is. Chrome
  // follows attention, never the doc (STAGE.md, "Activation"), and the editor's chrome
  // is the Edit hand's (scene.edit, src/stage/bodies.js): the toolbar's editor commands
  // (its world commands show in every body: HISTORY.md, TOOLS Decisions 10), the halo
  // and its knobs, the inspector (one drawer tab: the object tree and the
  // selection's fields, open once something is selected), dimensions and
  // parts (tabs the viewer opens), the grid, axes
  // and bounds, and every command marked `edit: true` show only there.
  {
    type: "scene:view",
    id: "scene.toolbar",
    name: "Toolbar",
    async load() {
      return (await import("./parts/toolbar.js")).default;
    },
  },
  // the packages this scene lists and this viewer doesn't have: one prompt to
  // load them (STAGE.md, "Packages")
  {
    type: "scene:view",
    id: "scene.packages",
    name: "Packages",
    async load() {
      return (await import("./parts/packages.js")).default;
    },
  },
  {
    // the use prompt ("[F] Raise the anchor"): attention's verbs, shown
    // (scene.keys does them)
    type: "scene:view",
    id: "scene.use",
    name: "Use prompt",
    async load() {
      return (await import("./parts/use.js")).default;
    },
  },
  {
    // the body chip, who's here and the Esc hint (STAGE.md, "Bodies")
    type: "scene:view",
    id: "scene.body",
    name: "Body",
    async load() {
      return (await import("./parts/body.js")).default;
    },
  },
  {
    // the touch controls: the declared keys as controls a finger holds, while the input is touch (STAGE.md, "Keys")
    type: "scene:view",
    id: "scene.touch",
    name: "Touch controls",
    async load() {
      return (await import("./parts/touch.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.keys",
    name: "Keyboard shortcuts",
    async load() {
      return (await import("./parts/keys.js")).default;
    },
  },
  {
    // every target's verbs, Select first (STAGE.md, "The input chain")
    type: "scene:view",
    id: "scene.menu",
    name: "Context menu",
    async load() {
      return (await import("./parts/menu.js")).default;
    },
  },
  {
    // Enter a link: the focus, which scopes the selection, moves into it (STAGE.md, "The input chain")
    type: "scene:view",
    id: "scene.focus",
    name: "Enter",
    async load() {
      return (await import("./parts/focus.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.frame",
    name: "Frame",
    async load() {
      return (await import("./parts/frame.js")).default;
    },
  },
  {
    // an untouched camera follows the content in as it loads
    type: "scene:view",
    id: "scene.autoframe",
    name: "Frame on open",
    async load() {
      return (await import("./parts/autoframe.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.inspector",
    name: "Inspector",
    async load() {
      return (await import("./parts/inspector.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.measure",
    name: "Measure",
    async load() {
      return (await import("./parts/measure.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.handles",
    name: "Handles",
    async load() {
      return (await import("./parts/handles.js")).default;
    },
  },
  {
    // the selection's handles: move arrows, rotate rings and scale corners
    // outside its box, in its parent's frame (STAGE.md, "The input chain"). It follows the
    // selection
    type: "scene:view",
    id: "scene.halo",
    name: "Halo",
    async load() {
      return (await import("./parts/halo.js")).default;
    },
  },
  {
    // carrying: whatever has the trait can be picked up and put down, in
    // any stage whose doc has something carryable (STAGE.md, "Activation"):
    // the trait is its only reason to run.
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
    type: "scene:view",
    id: "scene.dimensions",
    name: "Dimensions",
    async load() {
      return (await import("./parts/dimensions.js")).default;
    },
  },
  {
    // the selection: Select is every menu's first entry (STAGE.md, "The input chain")
    type: "scene:view",
    id: "scene.select",
    name: "Selection",
    async load() {
      return (await import("./parts/select.js")).default;
    },
  },
  {
    // the Edit hand: picked up and put down by the viewer (the body chip's Edit), its click selects
    // (STAGE.md, "Hands")
    type: "scene:view",
    id: "scene.edit",
    name: "Edit",
    async load() {
      return (await import("./parts/edit.js")).default;
    },
  },
  {
    // everyone else's selection boxes: a part of every doc, so they show
    // wherever their doc is drawn, whatever the focus (STAGE.md, "Views, stages and links",
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
    type: "scene:view",
    id: "scene.grid",
    name: "Grid",
    async load() {
      return (await import("./parts/grid.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.axes",
    name: "Axes",
    async load() {
      return (await import("./parts/axes.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.bounds",
    name: "Bounds",
    async load() {
      return (await import("./parts/bounds.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.units",
    name: "Units",
    async load() {
      return (await import("./parts/units.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.legends",
    name: "Legends",
    async load() {
      return (await import("./parts/legends.js")).default;
    },
  },
  {
    type: "scene:view",
    id: "scene.add",
    name: "Add documents",
    async load() {
      return (await import("./parts/add.js")).default;
    },
  },
  // objects from another scene, or from this one: an outline row dragged
  // into this view, Copy and Paste (STAGE.md, "Copying objects")
  {
    type: "scene:view",
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
    type: "scene:view",
    id: "scene.parts",
    name: "Parts",
    async load() {
      return (await import("./parts/parts.js")).default;
    },
  },
  // the editor's own edits, undone and redone (HISTORY.md, TOOLS Decisions 2): this
  // viewer's, in the focus doc
  {
    type: "scene:view",
    id: "scene.undo",
    name: "Undo",
    async load() {
      return (await import("./parts/undo.js")).default;
    },
  },
  // the doc's world time: ▶ or ⏸, who paused it, a stall (only for a doc with a process)
  {
    type: "scene:view",
    id: "scene.clock-chip",
    name: "Clock",
    async load() {
      return (await import("./parts/clock.js")).default;
    },
  },
];
