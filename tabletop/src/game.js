// A tabletop-game doc is a game (GAME-FORMAT.md) and two things beside it:
// `drawn` (each piece's GLB file doc, pieces.js) and `tables` (the scenes
// set up from it). These read the game out of a doc and write one in. The
// web assets it's cached (`assets`) are the game's: they go wherever it goes.

/** The fields of a doc that are the game. */
export const GAME_FIELDS = Object.freeze(["format", "version", "title", "about", "players", "pieces", "setup", "seats", "camera", "variants", "origin", "assets"]);

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The game a doc holds, as plain data (what the validator checks and the JSON shows). */
export function gameOf(doc) {
  const g = {};
  for (const k of GAME_FIELDS) if (doc?.[k] !== undefined) g[k] = plain(doc[k]);
  return g;
}

/**
 * Write a game into a doc (inside a change): every game field replaced, `drawn` and `tables` kept.
 * `assets` is written entry by entry into the map the doc has (never a new map), so what a viewer
 * caches while the game is edited isn't lost in the merge.
 */
export function writeGame(d, game) {
  for (const k of GAME_FIELDS) {
    if (k === "assets") continue;
    if (game?.[k] !== undefined) d[k] = plain(game[k]);
    else if (k in d) delete d[k];
  }
  const assets = game?.assets ?? {};
  if (!d.assets) d.assets = {};
  for (const u of Object.keys(d.assets)) if (!(u in assets)) delete d.assets[u];
  for (const [u, a] of Object.entries(assets)) if (d.assets[u]?.file !== a?.file) d.assets[u] = plain(a);
  if (!d.drawn) d.drawn = {};
  if (!d.tables) d.tables = [];
}
