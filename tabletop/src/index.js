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

export const plugins = [
  {
    // what makes a scene a game table: seats, private zones, hidden cards and
    // their decks (src/table/extension.js; the scene's README, "Extensions")
    type: "scene:extension",
    id: "tabletop",
    name: "Tabletop",
    traits: ["tabletop.seats", "tabletop.zone", "tabletop.hidden"],
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
    },
    drops: ["*"],
    // playing needs these and nothing else: carry pieces, keys for verbs, a
    // right-click menu, framing, and somewhere for notices
    requires: ["scene.hand", "scene.keys", "scene.menu", "scene.frame", "scene.notices"],
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
];
