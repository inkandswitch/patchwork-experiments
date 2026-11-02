import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardTableDoc } from "./types";
import { DEFAULT_DECK_ID } from "./ops/deck";

export const CardTableDatatype: DatatypeImplementation<CardTableDoc> = {
  init(doc: CardTableDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "card-table" };
    doc.title = "Card Table";
    doc.deckSize = 52;
    doc.phase = "setup";
    doc.shuffleId = 0;
    doc.shuffleTurn = 0;
    doc.shuffleParticipants = [];
    doc.publicKey = null;
    doc.workingDeck = null;
    doc.publishedDeck = null;
    doc.zones = [
      {
        "@patchwork": { type: "card-zone" },
        id: DEFAULT_DECK_ID,
        title: "Deck",
        cards: [],
        layout: "stack",
        role: "deck",
      },
    ];
    doc.keyShares = {};
    doc.keyShareEnvelopes = {};
    doc.keyRequests = [];
  },

  getTitle(doc: CardTableDoc) {
    return doc.title || "Card Table";
  },

  setTitle(doc: CardTableDoc, title: string) {
    doc.title = title;
  },
};
