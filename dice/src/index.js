// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// A die is a document (datatype "die", src/die.js): its shape and what each
// face shows. It has a 2D panel of its own (tool "die"), it is built into a
// scene at real size (scene:source "die"), and in a scene it can be rolled,
// read, turned to a face by hand and thrown with others (scene:extension
// "dice"). The parts bin offers the usual dice under "Dice"; each makes a new
// die doc.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "die",
    name: "Die",
    icon: "Dice5",
    async load() {
      return (await import("./datatype.js")).DieDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "die",
    name: "Die",
    icon: "Dice5",
    supportedDatatypes: ["die"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    // a die doc → a GLB at real size, its faces drawn, saying what it is in extras.dice (src/die-glb.js)
    type: "scene:source",
    id: "die",
    name: "Die",
    icon: "Dice5",
    supportedDatatypes: ["die"],
    params: [],
    cost: "cheap",
    // bump when the same die would build to a different GLB
    version: 1,
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    // what makes a scene object a die: Roll, Turn, Roll all, and its panel docked beside the scene (src/extension.js)
    type: "scene:extension",
    id: "dice",
    name: "Dice",
    traits: ["dice.die"],
    // dice are played with, and edited too (turned by hand, their panel opened)
    activities: ["play", "edit"],
    describes: {
      "dice.die": {
        name: "Die",
        on: "object",
        blurb: "Press R over it in play to roll it, T to turn it to its next face; everyone is told what it shows. What it is comes from its own document",
      },
    },
    drops: ["die"],
    // playing with dice needs these and nothing else: carry them, the use
    // prompt (hover a die: "[R] Roll  [T] Turn"), keys for verbs, a
    // right-click menu, and somewhere for notices. scene.use comes before
    // scene.keys, so the prompt hears its verbs' keys first (scene/STAGE.md,
    // "The use prompt").
    requires: ["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.notices"],
    async load() {
      return (await import("./extension.js")).default;
    },
  },
  // the usual dice, in the editor's parts bin (src/parts.js)
  ...[
    { id: "die", part: "d6", name: "Die", icon: "Dice5", description: "A six-sided die with spots, 16 mm. Its faces, shape and colours are its own document: open it to change them" },
    { id: "d4", name: "d4", icon: "Triangle", description: "A four-sided die, read at its top corner" },
    { id: "d8", name: "d8", icon: "Diamond", description: "An eight-sided die" },
    { id: "d10", name: "d10", icon: "Diamond", description: "A ten-sided die, 0 to 9" },
    { id: "percentile", name: "Percentile dice", icon: "Percent", description: "A d10 and its tens (00 to 90), in one group to roll together" },
    { id: "d12", name: "d12", icon: "Pentagon", description: "A twelve-sided die" },
    { id: "d20", name: "d20", icon: "Hexagon", description: "A twenty-sided die" },
    { id: "coin", name: "Coin", icon: "Circle", description: "A coin: heads or tails" },
    { id: "plus-minus", part: "plusMinus", name: "Plus/minus dice", icon: "Diff", description: "Four dice with two plus, two minus and two blank faces each, in one group to roll together" },
    { id: "doubling", name: "Doubling cube", icon: "Box", description: "2 to 64, turned by hand to the next face; never rolled" },
  ].map(({ id, part, ...p }) => ({
    type: "scene:part",
    id: `dice.${id}`,
    category: "Dice",
    traits: ["dice.die"],
    ...p,
    async load() {
      return (await import("./parts.js"))[part ?? id];
    },
  })),
];
