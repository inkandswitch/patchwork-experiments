// A newspace is a FOLDER (a `docs` DocLink list, so it interoperates with every
// folder-aware tool) plus a `newspace` field holding the automerge URL of a
// SEPARATE "layout" document. The canvas layout (positions, drawings, shapes,
// embedded docs, sub-boxes) lives in that layout doc as one ordered `items`
// array — kept out of the folder so the folder stays a clean list.
//
//   folder/newspace doc : { title, docs: DocLink[], newspace: <layout url> }
//   layout doc          : { "@patchwork": { type: "newspace-layout" }, items: Item[] }
//
// Item kinds (in the layout doc; array order = draw order):
//   stroke { id, kind, points:[[x,y,pressure]], color, size, thinning, smoothing, streamline, rotation }
//   shape  { id, kind, type, x, y, w, h, color, fill, strokeWidth, roughness, bowing, fillStyle, seed, rotation }
//   doc    { id, kind, url, x, y, w, h, rotation, toolId }
//   frame  { id, kind, url, x, y, w, h, style, well }   // a sub-space (a folder/newspace)
//
// Arrays only, never deletable map keys: the solid document projection applies
// list splices cleanly but trips on map-key deletion.

export const NewspaceDatatype = {
  init(doc) {
    doc.title = "Sketchy";
    doc.docs = [];
  },
  getTitle(doc) {
    return doc.title || "Sketchy";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + (doc.title || "Sketchy");
  },
};
