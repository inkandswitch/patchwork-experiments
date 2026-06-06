export const plugins = [
  {
    type: "patchwork:tool",
    id: "paper-rect",
    name: "Rectangle Layer",
    icon: "Square",
    supportedDatatypes: ["paper-layer"],
    async load() {
      const { RectLayerTool } = await import("./RectLayerTool");
      return RectLayerTool;
    },
  },
];
