export const resizePlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-resize",
    name: "Resize Layer",
    icon: "Maximize2",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./layer.js")).default;
    },
  },
];
