export const plugins = [
  {
    type: "patchwork:datatype",
    id: "worker",
    name: "Worker",
    icon: "Repeat",
    async load() {
      const { workerDatatype } = await import("./datatype.ts");
      return workerDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "worker",
    name: "Worker",
    supportedDatatypes: ["worker"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
