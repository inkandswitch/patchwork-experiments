// The tabletop-game datatype. See README.md for the document shape.

export const TabletopGameDatatype = {
  init(doc) {
    doc.title = "Untitled game";
    doc.about = "";
    doc.pieces = {};
    doc.order = [];
    doc.tables = [];
  },
  getTitle(doc) {
    return doc?.title || "Untitled game";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "game"}`;
    // the copy builds its own piece GLBs and sets up its own tables
    for (const p of Object.values(doc.pieces ?? {})) {
      p.glbUrl = null;
      p.glbKey = null;
    }
    doc.tables = [];
  },
};
