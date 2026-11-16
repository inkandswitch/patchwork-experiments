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
    // a machine in a scene: its session run on the scene's world time, its picture and sound at the cabinet's
    // screen, a seat per port, and Play, the pad in hand; a Doom's world drawn in doom/'s map (../scene/extension.js)
    type: "scene:extension",
    id: "machine",
    name: "Machines",
    traits: ["machine", "machine.world"],
    describes: {
      machine: {
        name: "Machine",
        on: "object",
        blurb: "An existing game, run as is, in step for everyone here; its picture and sound come from its screen. Play (a click on it, or P) sits you at its first free seat with that port's pad in hand (its keys shown at the top left; Escape puts the pad down, P picks it up), and standing up gives the port back; where it has no seats, P plays and Escape gives the port back. It stops while nobody plays, showing the last picture",
        fields: [{ key: "player", label: "Screen shows player (Doom, from 0)", kind: "number", default: 0, min: 0, max: 3, step: 1 }],
        // the session (and the source it was made for) is this object's running game: a copy starts a game of its own.
        // `seats` (the seat of each port, laid on the object with it) describes the cabinet, and goes with a copy as its seats do
        runtime: ["session", "source"],
      },
      "machine.world": {
        name: "Machine's world",
        on: "object",
        blurb: "A Doom map showing a machine's game: its monsters, players and doors move here as the game has them, read from the running engine. Laid out from the machine (Lay out its world)",
      },
    },
    // a machine doc is a new cabinet; a ROM or an IWAD dropped on a cabinet with no game is its game
    drops: ["machine", "file"],
    async load() {
      return (await import("../scene/extension.js")).default;
    },
  },
  {
    // an empty cabinet from the parts bin: drop a ROM or an IWAD on it (../scene/part.js)
    type: "scene:part",
    id: "machine",
    name: "Machine",
    icon: "Gamepad2",
    category: "Games",
    description: "A cabinet for an existing game: drop a Super NES ROM or a Doom IWAD on it, and press P at it to play",
    traits: ["machine"],
    async load() {
      return (await import("../scene/part.js")).default;
    },
  },
];
