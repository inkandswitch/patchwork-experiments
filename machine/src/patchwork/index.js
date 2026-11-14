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
  {
    // a machine doc → its cabinet, the screen's place said in its extras (../scene/cabinet.js)
    type: "scene:source",
    id: "machine",
    content: "built",
    name: "Machine",
    icon: "Gamepad2",
    supportedDatatypes: ["machine"],
    params: [],
    cost: "cheap",
    // bump when the same kind would build to a different cabinet
    version: 1,
    async load() {
      return (await import("../scene/source.js")).default;
    },
  },
  {
    // a machine in a scene: its session run on the scene's world time, its picture on the cabinet's screen,
    // and Play, the pad in hand (../scene/extension.js)
    type: "scene:extension",
    id: "machine",
    name: "Machines",
    traits: ["machine"],
    describes: {
      machine: {
        name: "Machine",
        on: "object",
        blurb: "An existing game, run as is, in step for everyone here; its picture is on its screen. P plays (a free port, the pad in hand); Escape gives the port back. It stops while nobody plays",
        fields: [{ key: "player", label: "Screen shows player (from 0)", kind: "number", default: 0, min: 0, max: 3, step: 1 }],
        // the session is this object's running game: a copy starts a game of its own
        runtime: ["session"],
      },
    },
    drops: ["machine"],
    async load() {
      return (await import("../scene/extension.js")).default;
    },
  },
];
