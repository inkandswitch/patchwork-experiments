export const plugins = [
  {
    type: "patchwork:datatype",
    id: "llm-canvas",
    name: "LLM Canvas",
    icon: "PenLine",
    async load() {
      const { datatype } = await import("./datatype.ts");
      return datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "llm-canvas",
    name: "LLM Canvas",
    supportedDatatypes: ["llm-canvas"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
