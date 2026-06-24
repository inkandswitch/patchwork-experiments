import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type {
  SecureDeckZone,
  SecureHandZone,
  SecurePileZone,
} from "./types";

/** Sub-zone type — lives inside a {@link CardTableDoc}, not as a standalone doc. */
export const SecureDeckDatatype: DatatypeImplementation<SecureDeckZone> = {
  init(_doc: SecureDeckZone, _repo: Repo) {
    throw new Error("Create decks from a card-table document");
  },
  getTitle(doc) {
    return doc.title || "Deck";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

/** Sub-zone type — lives inside a {@link CardTableDoc}, not as a standalone doc. */
export const SecureHandDatatype: DatatypeImplementation<SecureHandZone> = {
  init(_doc: SecureHandZone, _repo: Repo) {
    throw new Error("Create hands from a card-table document");
  },
  getTitle(doc) {
    return doc.title || "Hand";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

/** Sub-zone type — lives inside a {@link CardTableDoc}, not as a standalone doc. */
export const SecurePileDatatype: DatatypeImplementation<SecurePileZone> = {
  init(_doc: SecurePileZone, _repo: Repo) {
    throw new Error("Create piles from a card-table document");
  },
  getTitle(doc) {
    return doc.title || "Pile";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
