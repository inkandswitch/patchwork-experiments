export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tile-canvas",
    name: "Tile Canvas",
    icon: "PenLine",
    async load() {
      const { datatype } = await import("./datatype.ts");
      return datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tile-canvas",
    name: "Tile Canvas",
    supportedDatatypes: ["tile-canvas"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
