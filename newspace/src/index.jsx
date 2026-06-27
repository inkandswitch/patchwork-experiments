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
