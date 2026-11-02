import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardZone } from "./types";

/** Sub-zone type — lives inside a {@link CardTableDoc}, not as a standalone doc. */
export const CardZoneDatatype: DatatypeImplementation<CardZone> = {
  init(_doc: CardZone, _repo: Repo) {
    throw new Error("Create zones from a card-table document");
  },
  getTitle(doc) {
    return doc.title || (doc.role === "deck" ? "Deck" : "Zone");
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
