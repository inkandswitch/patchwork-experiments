import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardTableDoc } from "./types";

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
    doc.decks = [
      {
        "@patchwork": { type: "secure-deck" },
        id: "deck",
        title: "Deck",
        cards: [],
      },
    ];
    doc.keyShares = {};
    doc.keyShareEnvelopes = {};
    doc.keyRequests = [];
    doc.hands = [];
    doc.piles = [];
  },

  getTitle(doc: CardTableDoc) {
    return doc.title || "Card Table";
  },

  setTitle(doc: CardTableDoc, title: string) {
    doc.title = title;
  },
};
