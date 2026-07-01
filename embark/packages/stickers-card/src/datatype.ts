import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { StickersCardDoc } from "./types";

export const StickersCardDatatype: DatatypeImplementation<StickersCardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "stickers-card" };
    doc.title = "Stickers";
  },
  getTitle(doc) {
    return doc.title || "Stickers";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
