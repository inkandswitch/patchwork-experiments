export const textPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-text",
    name: "Text",
    icon: "Type",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./place-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "canvas-text",
    name: "Text Shape",
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./canvas-tool.js")).default;
    },
  },
];
