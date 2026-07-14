import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The single document type behind every card. Rather than each card feature
// registering its own datatype + tool, a card is a `card` document that names
// the behavior module it loads (`src`) and carries the chrome the shell draws
// around it (title, description, corner-pip icon, accent). Because that chrome
// lives on the document, the inert back face renders without ever loading the
// module.
//
// `flipped` deactivates the card: the shell renders only the back face and does
// not load `src`, so the card contributes nothing to the shared canvas context.
//
// Card-specific persisted state (e.g. bird sightings' kind/period) lives on the
// same document under extra fields; a module casts its handle to a widened type
// to read/write them.
export type CardDoc = {
  "@patchwork": { type: "card"; title: string };
  // Head-less module url of the card's behavior + middle-slot renderer, e.g.
  // `/automerge%3A<pkg rootUrl>/dist/card.js`.
  src: string;
  description: string;
  // Name of a glyph in the shared icon registry (see ./icons), drawn as the
  // mirrored corner pips.
  icon: string;
  // Pip color.
  accent: string;
  flipped?: boolean;
};

export const CardDatatype: DatatypeImplementation<CardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "card", title: "Card" };
    doc.src = "";
    doc.description = "";
    doc.icon = "card";
    doc.accent = "#16a34a";
  },
  getTitle(doc) {
    return doc["@patchwork"]?.title || "Card";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};
