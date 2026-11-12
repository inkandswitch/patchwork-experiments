// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// What a table's pieces do is two `scene:extension`s (src/table/):
// "tabletop" (hands, cards, Shuffle, Draw: in play and in edit) and
// "tabletop.rule" (who may see what, as the stage's `audience`: in every
// activity). Seats, and what a hidden card really is, are other packages'
// (the seats' owner; a keeper), met only through the stage.
//
// Games are `tabletop:game` plugins: { id, name, icon, players, blurb } and a
// load() whose module has `fill(doc)`, which fills an empty tabletop-game doc
// (inside a change). The game page offers every one that is registered, so
// another package can add games without touching this one.
//
// The built-in games are also `scene:template`s, so an empty scene can start
// as one of their tables without a game doc (src/table/template.js).
//
// Pieces for any table are `scene:part`s, in the editor's parts bin under
// "Tabletop": a pawn, a token and a card spot (a mat with one card slot)
// (src/table/parts.js). None of them makes seats. (Dice come from the dice
// package: its own parts, under "Dice".) So are a Card table to
// play at and Lost Cities, the whole game set down on whatever it's put on
// (a Card table aboard a ship); the game brings seats if the scene has none.

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
    // what a table's pieces do: hands, cards, Shuffle and Draw
    // (src/table/extension.js; the scene's README, "Extensions")
    type: "scene:extension",
    id: "tabletop",
    name: "Tabletop",
    traits: ["tabletop.zone", "tabletop.card"],
    // a table is played, and edited too
    activities: ["play", "edit"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // table can be set up without a script (src/table/visibility.js has the
    // shapes). A hand's box is plain JSON for now.
    describes: TRAITS,
    // playing needs these and nothing else: carry pieces, the use prompt
    // (hover a pile: "[F] Flip  [S] Shuffle pile  [D] Draw to my hand"; play
    // only, it does nothing while editing), keys for verbs, a right-click menu, a camera that opens
    // on the table, and somewhere for notices (not scene.frame: F is the
    // hand's flip at a table). scene.use comes before scene.keys, so the
    // prompt hears its verbs' keys first (scene/STAGE.md, "The use prompt").
    requires: ["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.autoframe", "scene.notices"],
    async load() {
      return (await import("./table/extension.js")).default;
    },
  },
  {
    // who may see what at a table: hands and face-up cards, as the stage's
    // `audience` (src/table/rule.js, visibility.js). No `activities`: it
    // holds while editing and whatever else a viewer is doing, since a
    // policy that stopped would take its screen with it.
    type: "scene:extension",
    id: "tabletop.rule",
    name: "Table rule",
    traits: ["tabletop.zone", "tabletop.card"],
    async load() {
      return (await import("./table/rule.js")).default;
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
  {
    type: "tabletop:game",
    id: "santorini",
    name: "Santorini",
    icon: "Castle",
    players: "2–3",
    blurb: "Build towers on an island and climb them. Everything is in plain sight.",
    async load() {
      return await import("./games/santorini.js");
    },
  },
  {
    type: "tabletop:game",
    id: "lost-cities",
    name: "Lost Cities",
    icon: "Map",
    players: "2",
    blurb: "Fund five expeditions with cards. Your hand is yours alone, and the deck is face down.",
    async load() {
      return await import("./games/lost-cities.js");
    },
  },
  // Draw Dominoes, laid for as many as play (games/dominoes.js): a table
  // whose players shuffle between them waits for every seat, so the count
  // is chosen when it's set up
  ...[2, 3, 4].map((n) => ({
    type: "tabletop:game",
    id: `draw-dominoes-${n}`,
    name: `Draw Dominoes (${n} players)`,
    icon: "Grid2x2",
    players: String(n),
    blurb: "A double-six set face down on the table: wash it, draw your tiles into your rack, play them face up in a line.",
    async load() {
      return (await import("./games/dominoes.js")).dominoes(n);
    },
  })),
  // the games' tables on an empty scene's start screen: one click lays the
  // table out in that scene, with its own art (src/table/template.js)
  {
    type: "scene:template",
    id: "tabletop.lost-cities",
    name: "Lost Cities",
    icon: "Map",
    description: "A two-player card table: five expeditions, a face-down deck and a private hand each",
    async load() {
      return (await import("./table/template.js")).lostCities;
    },
  },
  {
    type: "scene:template",
    id: "tabletop.santorini",
    name: "Santorini",
    icon: "Castle",
    description: "An island board with workers, building blocks and domes, everything in plain sight",
    async load() {
      return (await import("./table/template.js")).santorini;
    },
  },
  ...[2, 3, 4].map((n) => ({
    type: "scene:template",
    id: `tabletop.dominoes-${n}`,
    name: `Draw Dominoes, ${n} players`,
    icon: "Grid2x2",
    description: `A double-six set face down on a felt, and a rack for each of ${n} players where your tiles stand facing you`,
    async load() {
      return (await import("./table/template.js"))[`dominoes${n}`];
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
      name: "Lost Cities",
      icon: "Map",
      description: "The whole two-player table, set down where you put it: board, deck, a private hand each, and seats if the scene has none",
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    },
    ...[2, 3, 4].map((n) => ({
      id: `dominoes${n}`,
      part: `dominoes-${n}`,
      name: `Draw Dominoes, ${n} players`,
      icon: "Grid2x2",
      description: `The whole table for ${n}, set down where you put it: the felt, the boneyard face down, a rack each, and seats if the scene has none`,
      tags: ["tabletop.game"],
      traits: ["tabletop.zone", "tabletop.card"],
    })),
  ].map(({ id, part, ...p }) => ({
    type: "scene:part",
    id: `tabletop.${part ?? id}`,
    category: "Tabletop",
    ...p,
    async load() {
      return (await import("./table/parts.js"))[id];
    },
  })),
];
