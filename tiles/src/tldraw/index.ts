export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tiles",
    name: "Tiles",
    icon: "PenLine",
    importPath: "./dist/tldraw-datatype.js",
  },
  {
    type: "patchwork:tool",
    id: "tiles",
    name: "Tiles",
    supportedDatatypes: ["tiles"],
    importPath: "./dist/tldraw-tool.js",
  },
];
