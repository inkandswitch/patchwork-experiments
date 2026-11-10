// The "Naval study" datatype: hulls and designs screened side by side.

import { newStudy } from "./doc.js";

export const NavalStudyDatatype = {
  init(doc) {
    for (const [k, v] of Object.entries(newStudy())) doc[k] = v;
  },
  getTitle(doc) {
    return doc?.title || "Naval study";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc?.title || "study"}`;
  },
};

export default NavalStudyDatatype;
