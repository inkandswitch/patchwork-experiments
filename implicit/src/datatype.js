// patchwork:datatype "implicit-surface"
//
//   {
//     "@patchwork": { type: "implicit-surface" },   // stamped by the host on create
//     title:  string,
//     source: string,      // the SDF program (collaborative text)
//     bounds: { min: [x, y, z], max: [x, y, z] },   // metres, Y up
//     notes:  string,
//   }
//
// The host's createDocOfDatatype runs init() and then sets
// doc["@patchwork"] = { type: "implicit-surface", … } itself, which is what the
// Scene tool matches providers on — so init() does not write it.

import { DEFAULT_EXAMPLE } from "./examples.js";

export const ImplicitSurfaceDatatype = {
  init(doc) {
    doc.title = "Implicit surface";
    doc.source = DEFAULT_EXAMPLE.source;
    doc.bounds = { min: [...DEFAULT_EXAMPLE.bounds.min], max: [...DEFAULT_EXAMPLE.bounds.max] };
    doc.notes = "";
  },
  getTitle(doc) {
    return doc?.title || "Implicit surface";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc?.title || "Implicit surface"}`;
  },
};

export default ImplicitSurfaceDatatype;
