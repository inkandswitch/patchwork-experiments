export const dropPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-drop",
    name: "Drop Layer",
    icon: "Download",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./layer.js")).default;
    },
  },
];
