// The die datatype. See die.js for the document shape.

import { presetDoc } from "./die.js";

export const DieDatatype = {
  // a new die is a d6 with spots, 16 mm across
  init(doc) {
    Object.assign(doc, presetDoc("d6"));
  },
  getTitle(doc) {
    return doc?.title || "Die";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "die"}`;
    // the copy hasn't been rolled
    doc.rolls = [];
  },
};
