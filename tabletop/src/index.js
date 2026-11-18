// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// What a table's pieces do is one `scene:extension`, "tabletop"
// (src/table/): hands, cards, Shuffle, Draw, and who may see what, as the
// stage's `audience`. It runs wherever a doc has a hand or a card, whatever
// anyone is doing, so its policy never stops under a viewer. Seats are the
// seats package's (its `roster`), and what a hidden card really is, is a
// keeper's (src/keep/): both met only through the stage.
//
// Games are data: a tabletop-game (GAME-FORMAT.md) is one JSON file in
// games/, each a `tabletop:game` plugin: { id, name, icon, players, blurb }
// and a load() that resolves to the game itself. The game page offers every
// one that is registered, so another package can add games without touching
// this one. Each is also a `scene:template` and most a `scene:part`, which
// load their game by id (src/table/template.js setUp): no code knows any one
// game.
//
// Pieces for any table are `scene:part`s, in the editor's parts bin under
// "Tabletop": a pawn, a token and a card spot (src/table/parts.js), a Card
// table to play at, and the games, each set down on whatever it's put on (a
// Card table aboard a ship); a game brings its own seats, so a room can hold
// several tables. The rest, each under src/<area>/:
//
// - dice/   a die is a document ("die"): its own panel, built into a scene
//           at real size (scene:source "die"), rolled, read and turned there
//           ("dice"); cups ("dice.cup"); every roll drawn by lots between
//           the clients of those present ("dice.lots"); parts under "Dice".
// - bag/    a token bag: a container doc holding scene objects out of the
//           scene ("bag"), its panel, a sack (scene:source "bag-sack").
// - keep/   keepers: the plain one ("keep.plain", a "keep-plain" doc) and the
//           joint one ("card-table", a "secure-deck" the players shuffle
//           between them). `keeper: <kind>` is how the scene finds them.
// - tts/    a Tabletop Simulator mod translated into a tabletop-game.

const TRAITS = {
  "tabletop.zone": {
    name: "Hand",
    on: "object",
    blurb: "A seat's private area: what lies in this box (in the object's own frame, metres) is turned toward whoever sits in its seat, and screened from everyone else",
    fields: [
      // a seat's id, as whoever owns seats names it (this package never reads the seats themselves)
      { key: "seat", label: "Seat (its id)", kind: "string", default: "" },
      { key: "min", label: "Box min", kind: "json" },
      { key: "max", label: "Box max", kind: "json" },
    ],
    init: { min: [-0.1, 0, -0.05], max: [0.1, 0.05, 0.05] },
  },
  "tabletop.card": {
    name: "Card",
    on: "object",
    blurb: "Two-sided: lying face up outside every hand it is shown to everyone, face down to nobody. In a pile it can be shuffled (S) and drawn (D). What it really is, is its keeper's",
  },
};

export const plugins = [
  {
    // what a table's pieces do: hands, cards, Shuffle and Draw, and who
    // may see what (src/table/extension.js, visibility.js; the scene's
    // README, "Extensions")
    type: "scene:extension",
    id: "tabletop",
    name: "Tabletop",
    traits: ["tabletop.zone", "tabletop.card"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // table can be set up without a script (src/table/visibility.js has the
    // shapes). A hand's box is plain JSON for now.
    describes: TRAITS,
    async load() {
      return (await import("./table/extension.js")).default;
    },
  },
  {
    // Start game (src/table/start.js): the table's, so by the scene's trait, an extension of its own (the cards'
    // runs for object traits, its verbs in their place on the use prompt; this one's only verb is the scene's)
    type: "scene:extension",
    id: "tabletop.start",
    name: "Start game",
    traits: ["tabletop.start"],
    describes: {
      "tabletop.start": {
        name: "Start game",
        on: "scene",
        blurb: "What Start game does once every seat is taken (shuffle, deal, who goes first), as the table was laid out from its game's recipe. Made by the table, not by hand",
        // whether it has started, and the lots for who goes first, are play: a copy starts unstarted
        runtime: ["started", "round"],
      },
    },
    async load() {
      return (await import("./table/start.js")).default;
    },
  },
  {
    // a piece's other looks (GAME-FORMAT.md §4, src/table/states.js): turned with PgDn / PgUp or a number key,
    // for everyone; its trait the table writer's, on every thing whose piece has states
    type: "scene:extension",
    id: "tabletop.states",
    name: "States",
    traits: ["tabletop.states"],
    describes: {
      "tabletop.states": {
        name: "States",
        on: "object",
        blurb: "Other looks this piece can be turned to (PgDn, PgUp, a number key), for everyone: every look it has, the one it was laid out in, and the one it shows now. Made by the table, not by hand",
        // which look it shows now is play: a copy shows the one it was laid out in
        runtime: ["shown"],
      },
    },
    async load() {
      return (await import("./table/states.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "tabletop-game",
    name: "Tabletop game",
    icon: "Dices",
    async load() {
      return (await import("./datatype.js")).TabletopGameDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tabletop-game",
    name: "Tabletop game",
    icon: "Dices",
    supportedDatatypes: ["tabletop-game"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  // a game library: a folder-shaped doc holding Games (descriptions) and
  // Sessions (scenes), and the launcher, its default tool (src/library/)
  {
    type: "patchwork:datatype",
    id: "game-library",
    name: "Game library",
    icon: "Library",
    async load() {
      return (await import("./library/datatype.js")).GameLibraryDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "game-library",
    name: "Game library",
    icon: "Library",
    supportedDatatypes: ["game-library"],
    async load() {
      return (await import("./library/tool.js")).default;
    },
  },
  // the games, as data (games/*.json): each loads to the game itself. Draw
  // Dominoes is one game whose recipe asks how many play (a table whose
  // players shuffle between them waits for every seat, so the count is
  // chosen when it's set up: GAME-FORMAT.md §6, `recipe.options`)
  ...[
    { id: "santorini", name: "Santorini", icon: "Castle", players: "2–3", blurb: "Build towers on an island and climb them. Everything is in plain sight.", load: () => import("../games/santorini.json", { with: { type: "json" } }) },
    { id: "lost-cities", name: "Lost Cities", icon: "Map", players: "2", blurb: "Fund five expeditions with cards. Your hand is yours alone, and the deck is face down.", load: () => import("../games/lost-cities.json", { with: { type: "json" } }) },
    { id: "draw-dominoes", name: "Draw Dominoes", icon: "Grid2x2", players: "2–4", blurb: "A double-six set face down on the table: wash it, draw your tiles into your rack, play them face up in a line.", load: () => import("../games/draw-dominoes.json", { with: { type: "json" } }) },
  ].map(({ load, ...g }) => ({
    type: "tabletop:game",
    ...g,
    async load() {
      return (await load()).default;
    },
  })),
  // the games' tables on an empty scene's start screen: one click lays the
  // table out in that scene, with its own art (src/table/template.js).
  // `game` is the game the table is of; a template's params are its game's
  // options (metadata, so fixed here: Draw Dominoes asks how many play,
  // under its button, EDITOR.md "Templates")
  ...[
    { id: "lost-cities", name: "Lost Cities", icon: "Map", description: "A two-player card table: five expeditions, a face-down deck and a private hand each" },
    { id: "santorini", name: "Santorini", icon: "Castle", description: "An island board with workers, building blocks and domes, everything in plain sight" },
    {
      id: "dominoes",
      name: "Draw Dominoes",
      icon: "Grid2x2",
      description: "A double-six set face down on a felt, and a rack for each player where your tiles stand facing you",
      params: [{ key: "players", label: "Players", kind: "enum", options: [2, 3, 4].map((n) => ({ value: n, label: String(n) })), default: 2 }],
      game: "draw-dominoes",
    },
  ].map(({ id, game = id, ...t }) => ({
    type: "scene:template",
    id: `tabletop.${id}`,
    ...t,
    async load() {
      return (await import("./table/template.js")).template(game);
    },
  })),
  // pieces for any table, in the editor's parts bin (src/table/parts.js)
  ...[
    { id: "pawn", name: "Pawn", icon: "PersonStanding", description: "A playing piece to move about the table" },
    { id: "token", name: "Token", icon: "Coins", description: "A flat counter: a coin, a marker, a life" },
    { id: "cardSpot", part: "card-spot", name: "Card spot", icon: "RectangleVertical", description: "A mat with one card slot: a card or a dropped deck squares onto it" },
    // somewhere to play, and a whole game to put on it (anywhere: a ship's cockpit rides it along)
    { id: "cardTable", part: "table", name: "Card table", icon: "RectangleHorizontal", description: "A table to play at, 0.76 × 1.2 m and 0.7 m high. A game dropped on it sits square in the middle of its top" },
    {
      id: "lostCities",
      part: "lost-cities",
      game: "lost-cities",
      name: "Lost Cities",
      icon: "Map",
      description: "The whole two-player table, set down where you put it: board, deck, a private hand each, and its own two seats",
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    },
    {
      id: "santorini",
      game: "santorini",
      name: "Santorini",
      icon: "Castle",
      description: "The island board, its buildings and the workers, set down where you put it, and a seat for each colour",
      tags: ["tabletop.game"],
    },
    ...[2, 3, 4].map((n) => ({
      id: `dominoes${n}`,
      part: `dominoes-${n}`,
      game: "draw-dominoes",
      options: { players: n },
      name: `Draw Dominoes, ${n} players`,
      icon: "Grid2x2",
      description: `The whole table for ${n}, set down where you put it: the felt, the boneyard face down, a rack each, and a seat for each player`,
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    })),
  ].map(({ id, part, game, options, ...p }) => ({
    type: "scene:part",
    id: `tabletop.${part ?? id}`,
    category: "Tabletop",
    ...p,
    async load() {
      const parts = await import("./table/parts.js");
      return game ? parts.gamePart(game, options) : parts[id];
    },
  })),
  // ── dice (src/dice/) ──
  {
    type: "patchwork:datatype",
    id: "die",
    name: "Die",
    icon: "Dice5",
    async load() {
      return (await import("./dice/datatype.js")).DieDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "die",
    name: "Die",
    icon: "Dice5",
    supportedDatatypes: ["die"],
    async load() {
      return (await import("./dice/tool.js")).default;
    },
  },
  {
    // a die doc → a GLB at real size, its faces drawn, saying what it is in extras.dice (src/die-glb.js)
    type: "scene:source",
    id: "die",
    content: "built",
    name: "Die",
    icon: "Dice5",
    supportedDatatypes: ["die"],
    params: [],
    cost: "cheap",
    // bump when the same die would build to a different GLB
    version: 1,
    async load() {
      return (await import("./dice/source.js")).default;
    },
  },
  {
    // what makes a scene object a die: Roll, Turn, Roll all, and its panel docked beside the scene (src/extension.js)
    type: "scene:extension",
    id: "dice",
    name: "Dice",
    traits: ["dice.die"],
    describes: {
      "dice.die": {
        name: "Die",
        on: "object",
        blurb: "Press R over it to roll it, T to turn it to its next face; everyone is told what it shows. What it is comes from its own document",
        // the draw of a throw it leads is about now: a copy starts with none
        runtime: ["round"],
      },
    },
    drops: ["die"],
    async load() {
      return (await import("./dice/extension.js")).default;
    },
  },
  {
    // dice cups: who may see under each (an audience policy), the dice under them shown as only their
    // holder's client can know them, and the cup verbs
    type: "scene:extension",
    id: "dice.cup",
    name: "Dice cups",
    traits: ["dice.cup"],
    describes: {
      "dice.cup": {
        name: "Dice cup",
        on: "object",
        blurb: "Covers the dice under it. S shakes it over the dice in front of it (a roll nobody chooses), hold P to peek under your own, L lifts it",
        fields: [
          { key: "up", label: "Lifted", kind: "boolean", default: true },
          { key: "blind", label: "Blind (kept from whoever shook it)", kind: "boolean", default: false },
        ],
        // who shook it, what's under it and its draw are about now: a copy starts as nobody's, with nothing shaken
        runtime: ["holder", "roll", "round"],
      },
    },
    async load() {
      return (await import("./dice/cup-extension.js")).default;
    },
  },
  {
    // every roll's draw, by lots between the clients of those present (src/lots-ext.js): it runs wherever there is
    // a die, a cup or a table's start (who goes first), and keeps its rounds in their traits (it describes none of
    // its own), so a member's client commits and opens whatever its viewer is doing
    type: "scene:extension",
    id: "dice.lots",
    name: "Dice lots",
    traits: ["dice.die", "dice.cup", "tabletop.start"],
    async load() {
      return (await import("./dice/lots-ext.js")).default;
    },
  },
  {
    // the game, as data: a tabletop-game, which the game page lists and lays out
    type: "tabletop:game",
    id: "liars-dice",
    name: "Liar's dice",
    icon: "Dices",
    players: "2–6",
    blurb: "The traditional cup-dice game: shake under your cup, peek, bid on all the dice, call a lie, lift.",
    async load() {
      return (await import("../games/liars-dice.json", { with: { type: "json" } })).default;
    },
  },
  {
    type: "scene:template",
    id: "dice.liars-dice",
    name: "Liar's dice",
    icon: "Dices",
    description: "The traditional cup-dice game (dudo, cacho): six seats, a cup and five dice each, a pool for lost dice. Shake, peek, bid, call, lift",
    async load() {
      return (await import("./table/template.js")).template("liars-dice");
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
      return (await import("./dice/parts.js"))[part ?? id];
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
      return (await import("./dice/table.js")).cupPart;
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
      return (await import("./dice/table.js")).poolPart;
    },
  },
  // ── bag (src/bag/) ──
  {
    type: "patchwork:datatype",
    id: "bag",
    name: "Token bag",
    icon: "ShoppingBag",
    async load() {
      return (await import("./bag/datatype.js")).BagDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "bag",
    name: "Token bag",
    icon: "ShoppingBag",
    supportedDatatypes: ["bag"],
    async load() {
      return (await import("./bag/tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "bag-sack",
    content: "built",
    name: "Token bag",
    icon: "ShoppingBag",
    supportedDatatypes: ["bag"],
    cost: "cheap",
    version: 1,
    async load() {
      return (await import("./bag/source.js")).default;
    },
  },
  {
    type: "scene:part",
    id: "bag.token-bag",
    name: "Token bag",
    icon: "ShoppingBag",
    category: "Containers",
    description: "A drawstring bag that holds things out of sight: drop them on it to put them in, press D over it to draw one",
    traits: ["bag.container"],
    async load() {
      return (await import("./bag/part.js")).tokenBag;
    },
  },
  {
    // what makes an object a container: things dropped on it go in, Draw
    // takes one out into your hand, and it shows how many it holds
    // (extension.js; the scene's STAGE.md is the contract it is built from)
    type: "scene:extension",
    id: "bag",
    name: "Bag",
    traits: ["bag.container"],
    describes: {
      "bag.container": {
        name: "Container",
        on: "object",
        blurb: "Holds other objects out of the scene, in a bag document: drop things on it to put them in, Draw (D) to take one out. Anyone who opens that document can read what is inside",
        // any object may be a container (a box lid, a cup): the document that keeps its contents
        fields: [{ key: "doc", label: "Contents (a bag document)", kind: "url" }],
      },
    },
    // a bag document dropped into a scene becomes a bag in it
    // carrying is the scene's, by the `scene.carry` trait; the use prompt
    // shows Draw over a bag; the menu has the verbs without a key
    drops: ["bag"],
    async load() {
      return (await import("./bag/extension.js")).default;
    },
  },
  // ── the TTS importer (src/tts/) ──
  {
    type: "patchwork:datatype",
    id: "tts-import",
    name: "Tabletop Simulator import",
    icon: "PackageOpen",
    async load() {
      return (await import("./tts/datatype.js")).TtsImportDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tts-import",
    name: "Tabletop Simulator import",
    icon: "PackageOpen",
    supportedDatatypes: ["tts-import"],
    async load() {
      return (await import("./tts/tool.js")).default;
    },
  },
  // ── keepers (src/keep/) ──
  {
    type: "scene:extension",
    id: "keep.plain",
    name: "Plain keeper",
    traits: ["keep.plain"],
    keeper: "plain",
    // by its trait alone: what is kept stays kept whatever the viewer is doing
    describes: {
      "keep.plain": {
        name: "Kept (in the open)",
        on: "object",
        blurb: "What this really is lives in a container document and is shown only to whoever may see it here. Anyone who opens that document can read it: a table, not a vault",
        // which slot of which container it is, is about this object in this scene: a copy has neither
        runtime: true,
        fields: [
          { key: "by", label: "Container", kind: "url", copy: "drop" },
          { key: "slot", label: "Slot", kind: "integer", default: 0, min: 0 },
        ],
      },
    },
    async load() {
      return (await import("./keep/plain-keeper.js")).default;
    },
  },
  {
    type: "patchwork:datatype",
    id: "keep-plain",
    name: "Kept things",
    icon: "Archive",
    unlisted: true, // made by whatever sets a scene up (plain-keeper.js contain), not from a menu
    async load() {
      return (await import("./keep/plain.js")).PlainDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "secure-deck",
    name: "Secure deck",
    icon: "Layers",
    unlisted: true, // made by whatever sets a scene up (joint-keeper.js contain), not from a menu
    async load() {
      return (await import("./keep/datatype.js")).SecureDeckDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "secure-deck",
    name: "Secure deck",
    icon: "Layers",
    supportedDatatypes: ["secure-deck"],
    async load() {
      return (await import("./keep/tool.js")).default;
    },
  },
  {
    // The joint keeper: what an object really is, kept in a secure deck the
    // seated players shuffle between them, shown to whoever the scene says
    // may see it (src/keep/joint-keeper.js). An ordinary scene extension,
    // attached to objects by its own trait.
    type: "scene:extension",
    id: "card-table",
    name: "Joint keeper",
    traits: ["card-table.kept"],
    keeper: "joint",
    // by its trait alone: what is kept stays kept, and keys go on being handed over, whatever the viewer is doing
    describes: {
      "card-table.kept": {
        name: "Kept (jointly)",
        on: "object",
        blurb: "What this really is lives in a secure deck that the seated players shuffle between them: nobody knows which is where, and it is shown only to whoever may see it here",
        // which position of which deck it is, is about this object in this scene: a copy has neither
        runtime: true,
        fields: [
          { key: "by", label: "Deck", kind: "url", copy: "drop" },
          { key: "slot", label: "Position", kind: "integer", default: 0, min: 0 },
        ],
      },
    },
    async load() {
      return (await import("./keep/joint-keeper.js")).default;
    },
  },
];
