export const penPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-pen",
    name: "Pen",
    icon: "Pen",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./pen-tool.js")).PenTool;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "canvas-pen",
    name: "Pen Shape",
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./canvas-tool.js")).default;
    },
  },
];
