export const plugins = [
  {
    type: "patchwork:tool",
    id: "embed-shape-layer",
    name: "Embed Layer",
    icon: "SquareStack",
    supportedDatatypes: ["shape-layer"],
    async load() {
      const { EmbedLayerTool } = await import("./EmbedLayerTool");
      return EmbedLayerTool;
    },
  },
];
