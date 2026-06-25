import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A generic card: free-form `props` plus a human-readable `content` string. The
// display name lives in `@patchwork.title` (read by token pills and the rest of
// the app). An optional top-level `viewUrl` names an inline render module: when
// set, an embed token for this card draws that custom face instead of a plain
// title pill. Contributors (e.g. the POI provider) mint cards to carry
// structured data — the schema-match provider then finds well-shaped subtrees
// inside `props`.
export type CardDoc = {
  "@patchwork": { type: "card"; title?: string };
  props: Record<string, unknown>;
  content: string;
  viewUrl?: string;
};

export const CardDatatype: DatatypeImplementation<CardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "card" };
    doc.props = {};
    doc.content = "";
  },
  getTitle(doc) {
    const title = doc["@patchwork"]?.title;
    if (typeof title === "string" && title) return title;
    if (doc.content) return doc.content;
    const name = doc.props?.name;
    return typeof name === "string" && name ? name : "Card";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};
