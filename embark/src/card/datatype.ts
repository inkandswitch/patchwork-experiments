import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A generic card: free-form `props` plus a human-readable `content` string.
// Contributors (e.g. the POI provider) mint cards to carry structured data —
// the schema-match provider then finds well-shaped subtrees inside `props`.
export type CardDoc = {
  "@patchwork": { type: "card" };
  props: Record<string, unknown>;
  content: string;
};

export const CardDatatype: DatatypeImplementation<CardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "card" };
    doc.props = {};
    doc.content = "";
  },
  getTitle(doc) {
    if (doc.content) return doc.content;
    const name = doc.props?.name;
    return typeof name === "string" && name ? name : "Card";
  },
  setTitle(doc, title) {
    doc.content = title;
  },
};
