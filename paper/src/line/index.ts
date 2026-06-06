export const plugins = [
  {
    type: "patchwork:tool",
    id: "paper-line",
    name: "Line Layer",
    icon: "PenLine",
    supportedDatatypes: ["paper-layer"],
    async load() {
      const { LineLayerTool } = await import("./LineLayerTool");
      return LineLayerTool;
    },
  },
];
