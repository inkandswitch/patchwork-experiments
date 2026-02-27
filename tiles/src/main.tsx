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
];
