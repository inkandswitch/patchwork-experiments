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
];
