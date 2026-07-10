import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc } from "./canvas";

export const EmbarkCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "embark-canvas" };
    doc.title = "Canvas";
    // Starts empty: examples and cards come from the Cards sidebar's parts
    // bin (see @embark/cards-sidebar), which every canvas shares — the bin is
    // no longer seeded as a per-canvas embed.
    doc.embeds = {};
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Canvas";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};
