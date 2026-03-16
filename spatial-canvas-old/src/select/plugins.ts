export const selectPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-tool-select",
    name: "Select",
    icon: "MousePointer",
    tags: ["spatial-canvas-tool"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./select-tool.js")).default;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-layer-selection",
    name: "Selection Layer",
    icon: "MousePointer",
    tags: ["spatial-canvas-layer"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./layer.js")).default;
    },
  },
];
