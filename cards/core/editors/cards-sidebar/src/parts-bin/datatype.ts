import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PartsBinDoc } from "./types";

// Survives for old canvases that still embed a parts-bin document. The doc's
// items are no longer read anywhere — the bin renders the code-defined catalog
// (see catalog.ts) — so init just stamps the shape.
export const PartsBinDatatype: DatatypeImplementation<PartsBinDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "parts-bin" };
    doc.title = "Parts bin";
    doc.items = [];
  },
  getTitle(doc) {
    return doc.title || "Parts bin";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
