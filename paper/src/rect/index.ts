export const plugins = [
  {
    type: "patchwork:tool",
    id: "rect-shape-layer",
    name: "Rectangle Layer",
    icon: "Square",
    supportedDatatypes: ["shape-layer"],
    async load() {
      const { RectLayerTool } = await import("./RectLayerTool");
      return RectLayerTool;
    },
  },
];
