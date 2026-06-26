import { NewspaceDatatype } from "./datatype.js";
import { highlighterPlugin } from "./highlighter.js";

export const plugins = [
  highlighterPlugin,
  {
    type: "patchwork:datatype",
    id: "newspace",
    name: "New Space",
    icon: "PenTool",
    async load() {
      return NewspaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "newspace",
    name: "New Space",
    icon: "PenTool",
    // Works on its own datatype and on any plain folder, exactly like `space`.
    supportedDatatypes: ["newspace", "folder"],
    async load() {
      const { NewspaceTool } = await import("./tool.jsx");
      return NewspaceTool;
    },
  },
];

console.log("newspace plugin loaded");
