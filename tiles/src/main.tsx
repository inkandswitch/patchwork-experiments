export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tiles",
    name: "Tiles",
    icon: "PenLine",
    importPath: "./dist/mount-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "tiles",
    name: "Tiles",
    supportedDatatypes: ["tiles"],
    importPath: "./dist/mount.js",
  },
  {
    type: "patchwork:datatype",
    id: "llm-process",
    name: "LLM Process",
    icon: "Cpu",
    importPath: "./dist/mount-process-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "llm-process",
    name: "LLM Process",
    supportedDatatypes: ["llm-process"],
    importPath: "./dist/mount-process.js",
  },
];
