import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardTableKeysDoc } from "./types";

export const CardTableKeysDatatype: DatatypeImplementation<CardTableKeysDoc> = {
  init(doc: CardTableKeysDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "card-table-keys" };
    doc.tableUrl = "" as AutomergeUrl;
    doc.playerId = "";
    doc.deckSize = 52;
    doc.main = { p: "0", q: "0", e: "0", d: "0" };
    doc.individual = [];
  },

  getTitle(doc) {
    return doc.playerId ? `Keys (${doc.playerId.slice(0, 8)}…)` : "Card table keys";
  },

  setTitle(_doc, _title) {
    // key docs are not user-renamed
  },
};
