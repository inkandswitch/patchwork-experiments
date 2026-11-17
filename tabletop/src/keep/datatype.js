// The secure-deck datatype. See README.md and deck.js for the doc shape.

import { newDeckDoc } from "./deck.js";

export const SecureDeckDatatype = {
  init(doc) {
    for (const [k, v] of Object.entries(newDeckDoc())) if (k !== "@patchwork") doc[k] = v;
  },
  getTitle(doc) {
    return doc?.title || "Secure deck";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
