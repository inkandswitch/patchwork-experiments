export const keyboardPlugins = [
  {
    type: "patchwork:tool" as const,
    id: "spatial-canvas-panel-keyboard",
    name: "Keyboard Shortcuts",
    tags: ["spatial-canvas-panel"],
    supportedDatatypes: ["spatial-canvas"],
    async load() {
      return (await import("./panel.js")).default;
    },
  },
];
