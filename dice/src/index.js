// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// A die is a document (datatype "die", src/die.js): its shape and what each
// face shows. It has a 2D panel of its own (tool "die"), it is built into a
// scene at real size (scene:source "die"), and in a scene it can be rolled,
// read, turned to a face by hand and thrown with others (scene:extension
// "dice"). The parts bin offers the usual dice under "Dice"; each makes a new
// die doc.
//
// Cups (scene:extension "dice.cup", src/cup-extension.js): a cup covers the
// dice under it, is shaken over them (a roll nobody chooses, drawn by lots),
// peeked under by its holder, lifted, knocked over. A template lays out a
// table of cup dice ("Liar's dice", src/table.js); the bin offers a cup with
// its dice, and a pool.

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
  {
    // dice cups: who may see under each (an audience policy, so no `activities`: it holds while anyone edits),
    // the dice under them shown as only their holder's client can know them, and the cup verbs in play
    type: "scene:extension",
    id: "dice.cup",
    name: "Dice cups",
    traits: ["dice.cup"],
    describes: {
      "dice.cup": {
        name: "Dice cup",
        on: "object",
        blurb: "Covers the dice under it. In play: S shakes it over the dice in front of it (a roll nobody chooses), hold P to peek under your own, L lifts it",
        fields: [
          { key: "up", label: "Lifted", kind: "boolean", default: true },
          { key: "blind", label: "Blind (kept from whoever shook it)", kind: "boolean", default: false },
        ],
        // who shook it and what's under it are about now: a copy starts as nobody's, with nothing shaken
        runtime: ["holder", "roll"],
      },
    },
    requires: ["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.notices"],
    async load() {
      return (await import("./cup-extension.js")).default;
    },
  },
  {
    type: "scene:template",
    id: "dice.liars-dice",
    name: "Liar's dice",
    icon: "Dices",
    description: "The traditional cup-dice game (dudo, cacho): six seats, a cup and five dice each, a pool for lost dice. Shake, peek, bid, call, lift",
    async load() {
      return (await import("./table.js")).liarsDice;
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
  // cups, after the dice: a cup with its dice, and a pool (src/table.js)
  {
    type: "scene:part",
    id: "dice.cup",
    name: "Dice cup",
    icon: "CupSoda",
    category: "Dice",
    description: "A dice cup, 9 cm tall, with five dice in front of it: shake it over them, peek under it, lift it",
    traits: ["dice.cup", "dice.die"],
    async load() {
      return (await import("./table.js")).cupPart;
    },
  },
  {
    type: "scene:part",
    id: "dice.pool",
    name: "Dice pool",
    icon: "Circle",
    category: "Dice",
    description: "A shallow dish for dice out of play",
    async load() {
      return (await import("./table.js")).poolPart;
    },
  },
];
