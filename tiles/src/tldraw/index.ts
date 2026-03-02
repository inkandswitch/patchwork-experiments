export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tile-canvas",
    name: "Tile Canvas",
    icon: "PenLine",
    importPath: "./dist/tldraw-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "tile-canvas",
    name: "Tile Canvas",
    supportedDatatypes: ["tile-canvas"],
    importPath: "./dist/tldraw-tool.js",
  },
];
