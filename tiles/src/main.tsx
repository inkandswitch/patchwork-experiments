import { plugins as tldrawPlugins } from "./tldraw/index.ts";

export const plugins = [
  ...tldrawPlugins,
  {
    type: "patchwork:datatype",
    id: "process",
    name: "Process",
    icon: "Cpu",
    importPath: "./dist/process-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "process",
    name: "Process",
    supportedDatatypes: ["process"],
    importPath: "./dist/process-tool.js",
  },
  {
    type: "patchwork:datatype",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    importPath: "./dist/chat-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "chat",
    name: "Chat",
    supportedDatatypes: ["chat"],
    importPath: "./dist/chat-tool.js",
  },
  {
    type: "patchwork:datatype",
    id: "worker",
    name: "Worker",
    icon: "Repeat",
    importPath: "./dist/worker-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "worker",
    name: "Worker",
    supportedDatatypes: ["worker"],
    importPath: "./dist/worker-tool.js",
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
