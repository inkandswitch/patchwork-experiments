import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type SearchDoc = {
  "@patchwork": { type: "search" };
  query: string;
  // The broker owns this: aggregated result document urls for the current
  // query. The search box only reads it (it only ever writes `query`).
  results: AutomergeUrl[];
};

export const SearchDatatype: DatatypeImplementation<SearchDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "search" };
    doc.query = "";
    doc.results = [];
  },
  getTitle(doc) {
    return doc.query ? `Search: ${doc.query}` : "Search";
  },
  setTitle(doc, title) {
    doc.query = title;
  },
};
