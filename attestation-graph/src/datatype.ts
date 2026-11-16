import { type GraphDoc, newDiagram } from "./model";

export const DEFAULT_TITLE = "Attestation graph";

export const AttestationGraphDatatype = {
  init(doc: GraphDoc) {
    doc.title = DEFAULT_TITLE;
    doc.diagrams = [newDiagram("Page-1")];
  },
  getTitle(doc: GraphDoc) {
    return doc.title || DEFAULT_TITLE;
  },
  setTitle(doc: GraphDoc, title: string) {
    doc.title = title;
  },
  markCopy(doc: GraphDoc) {
    doc.title = "Copy of " + (doc.title || DEFAULT_TITLE);
  },
};
