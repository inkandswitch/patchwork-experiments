// The datatypes. A study is made from the "new document" menu; its kept
// part, its runs and their results are made by the study tool and the run's
// code (unlisted).
import { defaultSetup } from "./setup.js";
import { initStudy } from "./protocol.js";

const titled = (fallback) => ({
  init(doc) {
    doc.title = fallback;
  },
  getTitle(doc) {
    return doc.title || fallback;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
});

export const StudyDatatype = {
  init(doc) {
    initStudy(doc, defaultSetup());
  },
  getTitle(doc) {
    return doc.title || "FEA study";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "FEA study"}`;
    // a copy keeps the part and the setup, not the runs (they belong to the original)
    doc.runs = [];
    doc.selected = null;
  },
};

export const RunDatatype = titled("FEA run");
export const PartDatatype = titled("FEA part");
