export const plugins = [
  {
    type: "patchwork:datatype",
    id: "process",
    name: "Process",
    icon: "Cpu",
    async load() {
      const { processDatatype } = await import("./datatype.ts");
      return processDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "process",
    name: "Process",
    supportedDatatypes: ["process"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
