export const embedPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-embed",
    name: "Embed",
    icon: "Layers",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./place-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "canvas-embed",
    name: "Embed Shape",
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./canvas-tool.js")).default;
    },
  },
];
