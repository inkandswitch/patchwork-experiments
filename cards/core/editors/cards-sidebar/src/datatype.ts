import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardStackDoc } from "./types";

// Created programmatically by the Cards sidebar (the global singleton, and a
// per-document stack on first drop) — never from the "new document" menu.
export const CardStackDatatype: DatatypeImplementation<CardStackDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "card-stack" };
    doc.title = "Cards";
    doc.cards = [];
  },
  getTitle(doc) {
    return doc.title || "Cards";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
