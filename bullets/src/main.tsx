// The entry module is loaded in a worker with no importmap, so nothing heavy
// (and no bare external like solid-js, no JSX that the compiler turns into a
// top-level solid-js/web import) may live in its static graph — every import
// stays behind an async load().
export const plugins = [
  {
    type: "patchwork:datatype" as const,
    id: "bullets",
    name: "Bullets",
    icon: "List",
    async load() {
      return (await import("./datatype.ts")).datatype;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "bullets",
    name: "Bullets",
    supportedDataTypes: ["bullets"],
    async load() {
      return (await import("./tool.tsx")).mount;
    },
  },
];
