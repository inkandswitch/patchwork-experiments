import type { PaperDoc, PaperLayerDoc } from "./types";

export const PaperDatatype = {
  init(doc: PaperDoc) {
    doc.title = "Paper";
    doc.layers = {};
  },
  getTitle(doc: PaperDoc) {
    return doc.title || "Paper";
  },
  setTitle(doc: PaperDoc, title: string) {
    doc.title = title;
  },
};

export const PaperLayerDatatype = {
  init(doc: PaperLayerDoc) {
    doc.title = "Layer";
    doc.shapes = [];
  },
  getTitle(doc: PaperLayerDoc) {
    return doc.title || "Layer";
  },
  setTitle(doc: PaperLayerDoc, title: string) {
    doc.title = title;
  },
};
