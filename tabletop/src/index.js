// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// What a table's pieces do is one `scene:extension`, "tabletop"
// (src/table/): hands, cards, Shuffle, Draw, and who may see what, as the
// stage's `audience`. It runs wherever a doc has a hand or a card, whatever
// anyone is doing, so its policy never stops under a viewer. Seats, and what
// a hidden card really is, are other packages' (the seats' owner; a keeper),
// met only through the stage.
//
// Games are data: a tabletop-game (GAME-FORMAT.md) is one JSON file. This
// package's are in games/, each a `tabletop:game` plugin: { id, name, icon,
// players, blurb } and a load() that resolves to the game itself. The game
// page offers every one that is registered, so another package can add games
// without touching this one (the dice package's Liar's dice).
//
// The built-in games are also `scene:template`s and `scene:part`s, which
// load their game by id (src/table/template.js setUp): no code here knows
// any one game. Another package's template or part lays a game out the same
// way, through this package's `tabletop` extension: its metadata says
// `tables: "tabletop-game"`, and its module's `setUp(ctx, gameId, options)`
// lays the game out in the drop context's scene.
//
// Pieces for any table are `scene:part`s, in the editor's parts bin under
// "Tabletop": a pawn, a token and a card spot (a mat with one card slot)
// (src/table/parts.js). None of them makes seats. (Dice come from the dice
// package: its own parts, under "Dice".) So are a Card table to
// play at and the games with hands (Lost Cities, Draw Dominoes), each set
// down on whatever it's put on (a Card table aboard a ship); a game brings
// seats if the scene has none.

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
    // how another package's template or part lays a game out: this module's setUp(ctx, gameId, options)
    tables: "tabletop-game",
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // table can be set up without a script (src/table/visibility.js has the
    // shapes). A hand's box is plain JSON for now.
    describes: TRAITS,
    async load() {
      return (await import("./table/extension.js")).default;
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
  // the games, as data (games/*.json): each loads to the game itself
  ...[
    { id: "santorini", name: "Santorini", icon: "Castle", players: "2–3", blurb: "Build towers on an island and climb them. Everything is in plain sight.", load: () => import("../games/santorini.json", { with: { type: "json" } }) },
    { id: "lost-cities", name: "Lost Cities", icon: "Map", players: "2", blurb: "Fund five expeditions with cards. Your hand is yours alone, and the deck is face down.", load: () => import("../games/lost-cities.json", { with: { type: "json" } }) },
    // Draw Dominoes, laid for as many as play: a table whose players shuffle
    // between them waits for every seat, so the count is chosen when it's set up
    ...[2, 3, 4].map((n) => ({
      id: `draw-dominoes-${n}`,
      name: `Draw Dominoes (${n} players)`,
      icon: "Grid2x2",
      players: String(n),
      blurb: "A double-six set face down on the table: wash it, draw your tiles into your rack, play them face up in a line.",
      load: () => (n === 2 ? import("../games/draw-dominoes-2.json", { with: { type: "json" } }) : n === 3 ? import("../games/draw-dominoes-3.json", { with: { type: "json" } }) : import("../games/draw-dominoes-4.json", { with: { type: "json" } })),
    })),
  ].map(({ load, ...g }) => ({
    type: "tabletop:game",
    ...g,
    async load() {
      return (await load()).default;
    },
  })),
  // the games' tables on an empty scene's start screen: one click lays the
  // table out in that scene, with its own art (src/table/template.js)
  ...[
    { id: "lost-cities", name: "Lost Cities", icon: "Map", description: "A two-player card table: five expeditions, a face-down deck and a private hand each" },
    { id: "santorini", name: "Santorini", icon: "Castle", description: "An island board with workers, building blocks and domes, everything in plain sight" },
    ...[2, 3, 4].map((n) => ({
      id: `dominoes-${n}`,
      game: `draw-dominoes-${n}`,
      name: `Draw Dominoes, ${n} players`,
      icon: "Grid2x2",
      description: `A double-six set face down on a felt, and a rack for each of ${n} players where your tiles stand facing you`,
    })),
  ].map(({ id, game, ...t }) => ({
    type: "scene:template",
    id: `tabletop.${id}`,
    ...t,
    async load() {
      return (await import("./table/template.js")).template(game ?? id);
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
      description: "The whole two-player table, set down where you put it: board, deck, a private hand each, and seats if the scene has none",
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    },
    ...[2, 3, 4].map((n) => ({
      id: `dominoes${n}`,
      part: `dominoes-${n}`,
      game: `draw-dominoes-${n}`,
      name: `Draw Dominoes, ${n} players`,
      icon: "Grid2x2",
      description: `The whole table for ${n}, set down where you put it: the felt, the boneyard face down, a rack each, and seats if the scene has none`,
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    })),
  ].map(({ id, part, game, ...p }) => ({
    type: "scene:part",
    id: `tabletop.${part ?? id}`,
    category: "Tabletop",
    ...p,
    async load() {
      const parts = await import("./table/parts.js");
      return game ? parts.gamePart(game) : parts[id];
    },
  })),
];
