import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type SearchDoc = {
  "@patchwork": { type: "search" };
  query: string;
};

export const SearchDatatype: DatatypeImplementation<SearchDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "search" };
    doc.query = "";
  },
  getTitle(doc) {
    return doc.query ? `Search: ${doc.query}` : "Search";
  },
  setTitle(doc, title) {
    doc.query = title;
  },
};
