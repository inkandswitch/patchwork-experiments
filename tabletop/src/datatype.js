// The tabletop-game datatype: a game (GAME-FORMAT.md), with each piece's GLB
// (`drawn`) and the tables set up from it (`tables`) beside it (game.js).

export const TabletopGameDatatype = {
  init(doc) {
    doc.format = "tabletop-game";
    doc.version = 2;
    doc.title = "Untitled game";
    doc.about = "";
    doc.pieces = {};
    doc.setup = [];
    // made with the game, never on first use: two viewers caching at once each making the map would
    // leave one map, and lose what the other cached in theirs
    doc.assets = {};
    doc.drawn = {};
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
    // the copy draws its own piece GLBs and sets up its own tables
    doc.drawn = {};
    doc.tables = [];
  },
};
