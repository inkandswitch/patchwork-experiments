// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Decks other than the plain one are `tabletop:deck` plugins: { id,
// supportedDatatypes } and a load() whose module has createResolver(...) (and,
// to be laid out when dropped on a table, placement(doc) and bind(handle,
// ids)); card-table's secure deck is one. See src/table/extension.js.
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
// "Tabletop": a pawn, a token, a card spot (a mat with one card slot) and a
// die (src/table/parts.js). None of them makes seats. So are a Card table to
// play at and Lost Cities, the whole game set down on whatever it's put on
// (a Card table aboard a ship); the game brings seats if the scene has none.

export const plugins = [
  {
    // what makes a scene a game table: seats, private zones, hidden cards and
    // their decks (src/table/extension.js; the scene's README, "Extensions")
    type: "scene:extension",
    id: "tabletop",
    name: "Tabletop",
    traits: ["tabletop.seats", "tabletop.zone", "tabletop.hidden", "tabletop.die"],
    // a table is played, and edited too: while editing, hidden cards still
    // stay hidden (only their deck says who may see them)
    activities: ["play", "edit"],
    // what the traits are, for the scene's inspector ("Add behaviour…"), so a
    // table can be set up without a script (src/table/visibility.js has the
    // shapes). A zone's box is plain JSON for now.
    describes: {
      "tabletop.seats": {
        name: "Seats",
        on: "scene",
        blurb: "The places players sit at this table",
        entries: { label: "Seats", noun: "seat", prefix: "seat", fields: [{ key: "name", label: "Name", kind: "string", default: "Seat" }], init: { player: null } },
      },
      "tabletop.zone": {
        name: "Private zone",
        on: "object",
        blurb: "Hidden cards in this box (in the object's own frame, metres) are shown only to whoever sits in its seat",
        fields: [
          { key: "seat", label: "Seat", kind: "entry", of: "tabletop.seats" },
          { key: "min", label: "Box min", kind: "json" },
          { key: "max", label: "Box max", kind: "json" },
        ],
        init: { min: [-0.1, 0, -0.05], max: [0.1, 0.05, 0.05] },
      },
      "tabletop.hidden": {
        name: "Hidden card",
        on: "object",
        blurb: "Drawn as itself (a card back) unless its deck says who may see what it really is",
        fields: [{ key: "by", label: "Deck", kind: "url" }],
      },
      // (src/table/dice.js: the default is a d6's, opposite sides adding to seven)
      "tabletop.die": {
        name: "Die",
        on: "object",
        blurb: "Press R over it in play to roll it; everyone is told what it shows. Faces says which number each side shows, by the local axis out of that side",
        fields: [{ key: "faces", label: "Faces", kind: "json", default: { "+y": 1, "-y": 6, "+x": 3, "-x": 4, "+z": 2, "-z": 5 } }],
      },
    },
    drops: ["*"],
    // playing needs these and nothing else: carry pieces, the use prompt
    // (hover a pile: "[F] Flip  [S] Shuffle pile  [D] Draw to my hand", a die:
    // "[R] Roll  [F] Flip"; play only, it does nothing
    // while editing), keys for verbs, a right-click menu, a camera that opens
    // on the table, and somewhere for notices (not scene.frame: F is the
    // hand's flip at a table). scene.use comes before scene.keys, so the
    // prompt hears its verbs' keys first (scene/STAGE.md, "The use prompt").
    requires: ["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.autoframe", "scene.notices"],
    async load() {
      return (await import("./table/extension.js")).default;
    },
  },
  {
    // a deck anyone can read: what each of its cards really is
    type: "patchwork:datatype",
    id: "plain-deck",
    name: "Deck",
    icon: "Layers",
    unlisted: true,
    async load() {
      return (await import("./table/plain-deck.js")).PlainDeckDatatype;
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
  // pieces for any table, in the editor's parts bin (src/table/parts.js)
  ...[
    { id: "pawn", name: "Pawn", icon: "PersonStanding", description: "A playing piece to move about the table" },
    { id: "token", name: "Token", icon: "Coins", description: "A flat counter: a coin, a marker, a life" },
    { id: "cardSpot", part: "card-spot", name: "Card spot", icon: "RectangleVertical", description: "A mat with one card slot: a card or a dropped deck squares onto it" },
    { id: "die", name: "Die", icon: "Dice6", description: "A six-sided die. Press R over it in play to roll it", traits: ["tabletop.die"] },
    // somewhere to play, and a whole game to put on it (anywhere: a ship's cockpit rides it along)
    { id: "cardTable", part: "table", name: "Card table", icon: "RectangleHorizontal", description: "A table to play at, 0.76 × 1.2 m and 0.7 m high. A game dropped on it sits square in the middle of its top" },
    {
      id: "lostCities",
      part: "lost-cities",
      name: "Lost Cities",
      icon: "Map",
      description: "The whole two-player table, set down where you put it: board, deck, a private hand each, and seats if the scene has none",
      tags: ["tabletop.game"],
      traits: ["tabletop.seats", "tabletop.zone", "tabletop.hidden"],
    },
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
