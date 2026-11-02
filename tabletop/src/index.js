// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Games are `tabletop:game` plugins: { id, name, icon, players, blurb } and a
// load() whose module has `fill(doc)`, which fills an empty tabletop-game doc
// (inside a change). The game page offers every one that is registered, so
// another package can add games without touching this one.

export const plugins = [
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
