export const toolbarPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-toolbar",
    name: "Toolbar",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./panel.js")).default;
    },
  },
];
