export const plugins = [
  {
    type: "patchwork:tool",
    id: "line-shape-layer",
    name: "Line Layer",
    icon: "PenLine",
    supportedDatatypes: ["shape-layer"],
    async load() {
      const { LineLayerTool } = await import("./LineLayerTool");
      return LineLayerTool;
    },
  },
];
