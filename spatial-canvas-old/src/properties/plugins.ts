export const propertiesPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-properties",
    name: "Properties",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./panel.js")).default;
    },
  },
];
