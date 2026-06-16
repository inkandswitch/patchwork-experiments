import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc } from "./EmbarkCanvas";

export const EmbarkCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init: (doc: EmbarkCanvasDoc) => {
    doc["@patchwork"] = { type: "embark-canvas" };
    doc.title = "Canvas";
    doc.embeds = {};
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Canvas";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};
