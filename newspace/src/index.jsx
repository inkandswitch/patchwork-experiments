import { NewspaceDatatype } from "./datatype.js";

export const plugins = [
  // brushes live in their own modules, dynamically imported in load() so their
  // code is a separate chunk (not pulled into the main bundle eagerly)
  {
    type: "sketchy:brush",
    id: "highlighter",
    name: "Highlighter",
    icon: "Highlighter",
    async load() {
      return (await import("./highlighter.js")).HighlighterBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "constraint",
    name: "Constraint sketch",
    icon: "Ruler",
    async load() {
      return (await import("./constraint.js")).ConstraintBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "voice",
    name: "Voice note",
    icon: "Mic",
    async load() {
      return (await import("./voice.js")).VoiceBrush;
    },
  },
  // sketchy:editor — a node with typed inlets/outlets carrying opstreams. inlets/
  // outlets are declared inline (readable without loading the editor); load()
  // returns the heavy mount fn. See src/editors.js for the contract.
  {
    type: "sketchy:editor",
    id: "codemirror",
    name: "Code",
    icon: "FileCode",
    supportedDatatypes: ["file", "*"],
    inlets: [
      { name: "content", type: "text", required: true },
      { name: "language", type: "language" },
    ],
    outlets: [{ name: "text", type: "text" }],
    async load() {
      return (await import("./codemirror/sketchy-editor.js")).mountCodemirror;
    },
  },
  // a generic inspector: shows a wired stream's live value (any shape) as JSON.
  // registered AFTER codemirror so text streams still prefer codemirror; non-text
  // (pointer/camera/selection/…) land here.
  {
    type: "sketchy:editor",
    id: "inspector",
    name: "Inspector",
    icon: "Eye",
    inlets: [{ name: "value", type: "json", required: true }],
    outlets: [],
    async load() {
      return (await import("./inspector-editor.js")).mountInspector;
    },
  },
  // a file-open editor: pick a local file (File System Access API) and edit it in
  // CodeMirror with Save. SOURCES content (no inlets); exposes it on `text`.
  {
    type: "sketchy:editor",
    id: "file",
    name: "Open file",
    icon: "FolderOpen",
    inlets: [],
    outlets: [{ name: "text", type: "text" }],
    async load() {
      return (await import("./codemirror/file-editor.js")).mountFileEditor;
    },
  },
  // sketchy:layout descriptors — a folder rendered through a lens. Each points at the
  // patchwork:tool that renders it; the layout switcher re-opens the folder with that
  // tool (same docs, different lens). See LAYOUTS.md.
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
  // a LIST layout for a folder — same docs as the canvas, different lens; surfaces
  // the canvas complement ("what you're not seeing"). See LAYOUTS.md.
  {
    type: "patchwork:tool",
    id: "sketchy:list",
    name: "List",
    icon: "List",
    unlisted: true,
    supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() {
      return (await import("./list-tool.jsx")).ListTool;
    },
  },
  // a simple form whose inputs are draggable PORTS (one per doc field)
  {
    type: "patchwork:tool",
    id: "form",
    name: "Fields",
    icon: "TextCursorInput",
    supportedDatatypes: ["*"],
    unlisted: true,
    async load() {
      return (await import("./form-tool.jsx")).FormTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "sketch",
    name: "Sketchy",
    icon: "PenTool",
    async load() {
      return NewspaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "sketchy",
    name: "Sketchy",
    icon: "PenTool",
    // its own datatype, the legacy `newspace` datatype, and any plain folder
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { NewspaceTool } = await import("./tool.jsx");
      return NewspaceTool;
    },
  },
];

console.log("sketchy plugin loaded");
