import type { PaperMapDoc } from "./types";

// The map is a surface: it starts with no layers (rect/line are created on
// demand the first time they draw, like a paper). We keep a title so it shows
// up sensibly in document lists.
export const PaperMapDatatype = {
  init(doc: PaperMapDoc) {
    doc.title = "Map";
    doc.layers = {};
  },
  getTitle(doc: PaperMapDoc) {
    return doc.title || "Map";
  },
  setTitle(doc: PaperMapDoc, title: string) {
    doc.title = title;
  },
};
