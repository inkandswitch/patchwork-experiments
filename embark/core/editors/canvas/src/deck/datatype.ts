import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { DeckDoc } from "./types";

export const DeckDatatype: DatatypeImplementation<DeckDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "deck" };
    doc.title = "Deck";
    doc.fanned = false;
    doc.cards = [];
  },
  getTitle(doc) {
    return doc.title || "Deck";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
