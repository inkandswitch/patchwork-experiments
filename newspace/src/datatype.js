// A newspace is a FOLDER (a `docs` DocLink list, so it interoperates with every
// folder-aware tool) plus a `newspace` field holding the automerge URL of a
// SEPARATE "layout" document. The canvas layout (positions, drawings, shapes,
// embedded docs, sub-boxes) lives in that layout doc as one ordered `items`
// array — kept out of the folder so the folder stays a clean list.
//
//   folder/sketch doc : { title, docs: DocLink[], sketch: <layout url> }   (was `.newspace`)
//   layout doc        : { "@patchwork": { type: "sketch-layout" }, items: Item[], layout }
//
// Item kinds (in the layout doc; array order = draw order):
//   stroke { id, kind, points:[[x,y,pressure]], color, size, thinning, smoothing, streamline, rotation }
//   shape  { id, kind, type, x, y, w, h, color, fill, strokeWidth, roughness, bowing, fillStyle, seed, rotation }
//   doc    { id, kind, url, x, y, w, h, rotation, toolId }
//   frame  { id, kind, url, x, y, w, h, style, well }   // a sub-space (a folder/newspace)
//
// Arrays only for canvas content — order IS z/draw order, and list splices
// reconcile cleanly through the solid document projection. (Historical note:
// this model was chosen when the projection tripped on map-key deletion; with
// the current solid-automerge (2.0.0) nested AND top-level key deletion both
// reconcile fine — pinned in history.test.js — so `delete o.group` etc. is
// safe, and arrays-only is a design choice here, not a workaround.)

export const NewspaceDatatype = {
  init(doc) {
    doc.title = "New sketch";
    doc.docs = [];
  },
  getTitle(doc) {
    return doc.title || "Sketch";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + (doc.title || "Sketch");
  },
};
