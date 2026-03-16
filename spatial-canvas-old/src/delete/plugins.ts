export const deletePlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-delete",
    name: "Delete",
    icon: "Eraser",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./delete-tool.js")).default;
    },
  },
];
