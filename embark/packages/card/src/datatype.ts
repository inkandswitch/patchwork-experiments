import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { CardDoc } from "@embark/core";

// The generic card document shape lives in @embark/core so every card-minting
// feature (poi, weather, route, ...) agrees on it; this package owns the
// datatype implementation. Re-exported here for local consumers (./CardTool).
export type { CardDoc };

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
