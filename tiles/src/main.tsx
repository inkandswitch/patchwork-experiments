import { plugins as tldrawPlugins } from "./tldraw/index.ts";

export const plugins = [
  ...tldrawPlugins,
  {
    type: "patchwork:datatype",
    id: "llm-process",
    name: "LLM Chat",
    icon: "Cpu",
    importPath: "./dist/process-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "llm-process",
    name: "LLM Chat",
    supportedDatatypes: ["llm-process"],
    importPath: "./dist/process-tool.js",
  },
  {
    type: "patchwork:datatype",
    id: "workspace",
    name: "Workspace",
    icon: "FolderOpen",
    importPath: "./dist/workspace-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "workspace",
    name: "Workspace",
    supportedDatatypes: ["workspace"],
    importPath: "./dist/workspace-tool.js",
  },
];
