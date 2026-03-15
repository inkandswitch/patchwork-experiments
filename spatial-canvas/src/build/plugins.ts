export const buildPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-build",
    name: "Build",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./panel.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "process",
    name: "Process",
    unlisted: true,
    supportedDatatypes: [],
    async load() {
      return (await import("./process-viewer.js")).default;
    },
  },
];
