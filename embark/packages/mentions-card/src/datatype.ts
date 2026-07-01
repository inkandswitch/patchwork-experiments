import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { MentionsCardDoc } from "./types";

export const MentionsCardDatatype: DatatypeImplementation<MentionsCardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "mentions-card" };
    doc.title = "Mentions";
  },
  getTitle(doc) {
    return doc.title || "Mentions";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
