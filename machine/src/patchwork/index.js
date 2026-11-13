// Plugin metadata only: this module is read in a worker, so nothing here may
// touch the DOM or import a bare specifier. Everything else is behind load().
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "machine",
    name: "Machine",
    icon: "Gamepad2",
    async load() {
      return (await import("./datatype.js")).MachineDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "machine",
    name: "Machine",
    icon: "Gamepad2",
    supportedDatatypes: ["machine"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    // A second view of the same machine: every state one peer's engine was
    // in, the inputs it stepped them with, and where its predictions proved
    // wrong and were rolled back.
    type: "patchwork:tool",
    id: "machine-history",
    name: "Machine history",
    icon: "GitFork",
    supportedDatatypes: ["machine"],
    async load() {
      return (await import("./history-tool.js")).default;
    },
  },
];
