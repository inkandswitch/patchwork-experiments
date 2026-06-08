import { ShapeLayerDoc } from "./types";

export const PaperLayerDatatype = {
  init(doc: ShapeLayerDoc) {
    doc.shapes = [];
  },
  getTitle(doc: ShapeLayerDoc) {
    return doc.title;
  },
  setTitle(doc: ShapeLayerDoc, title: string) {
    doc.title = title;
  },
};
