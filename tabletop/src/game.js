// A tabletop-game doc is a game (GAME-FORMAT.md) and two things beside it:
// `drawn` (each piece's GLB file doc, pieces.js) and `tables` (the scenes
// set up from it). These read the game out of a doc and write one in.

/** The fields of a doc that are the game. */
export const GAME_FIELDS = Object.freeze(["format", "version", "title", "about", "players", "pieces", "setup", "seats", "camera", "origin"]);

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The game a doc holds, as plain data (what the validator checks and the JSON shows). */
export function gameOf(doc) {
  const g = {};
  for (const k of GAME_FIELDS) if (doc?.[k] !== undefined) g[k] = plain(doc[k]);
  return g;
}

/** Write a game into a doc (inside a change): every game field replaced, `drawn` and `tables` kept. */
export function writeGame(d, game) {
  for (const k of GAME_FIELDS) {
    if (game?.[k] !== undefined) d[k] = plain(game[k]);
    else if (k in d) delete d[k];
  }
  if (!d.drawn) d.drawn = {};
  if (!d.tables) d.tables = [];
}
