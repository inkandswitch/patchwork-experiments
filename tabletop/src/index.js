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
    legacy: { scene: ["seats"], objects: ["zone", "hidden"] },
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
