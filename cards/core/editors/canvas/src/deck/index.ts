import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The deck: a datatype holding a pile of cards plus a tool that renders them as
// a fannable stack. A card dragged in is moved off the canvas; a card dealt out
// is moved back onto it.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "deck",
    name: "Deck",
    icon: "Layers",
    async load() {
      const { DeckDatatype } = await import("./datatype");
      return DeckDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "deck",
    name: "Deck",
    icon: "Layers",
    supportedDatatypes: ["deck"],
    async load() {
      const { DeckTool } = await import("./DeckTool");
      return DeckTool;
    },
  },
];
