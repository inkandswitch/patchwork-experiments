// The "Rig" datatype: a rig design, seeded as the stock 12 m sloop.

import { defaultDoc } from "./doc.js";

export const RigDesignDatatype = {
  init(doc) {
    const seed = defaultDoc();
    for (const [k, v] of Object.entries(seed)) doc[k] = v;
  },
  getTitle(doc) {
    return doc?.title || "Rig";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc?.title || "rig"}`;
  },
};

export default RigDesignDatatype;
