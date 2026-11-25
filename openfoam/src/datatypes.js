// The datatypes. A case is made from the "new document" menu; runs and
// kept hulls are made by the case tool (unlisted).
import { defaultSetup } from "./setup.js";
import { initCase } from "./protocol.js";

export const CaseDatatype = {
  init(doc) {
    initCase(doc, defaultSetup());
  },
  getTitle(doc) {
    return doc.title || "OpenFOAM case";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "OpenFOAM case"}`;
    // a copy keeps the setup and the hull, not the runs (they belong to the original)
    doc.runs = [];
    doc.selected = null;
  },
};

export const RunDatatype = {
  init(doc) {
    doc.title = "OpenFOAM run";
  },
  getTitle(doc) {
    return doc.title || "OpenFOAM run";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

/** A case's kept hull (src/hull/stash.js): written by the case tool, read by it. */
export const HullDatatype = {
  init(doc) {
    doc.title = "OpenFOAM hull";
  },
  getTitle(doc) {
    return doc.title || "OpenFOAM hull";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
