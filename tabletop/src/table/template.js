// The "Lost Cities" and "Santorini" templates (`scene:template`): an empty
// scene's start screen offers them, and one click lays the game's table out
// in that scene, through the same writer as the game page's "Set up a table"
// (setup.js tableLayout + writeTable), so the two can't drift apart.
//
// What differs from the game page's tables:
// - There is no game doc. The game is made in memory from its module's
//   fill(), and nothing is the table's About.
// - Each kind's GLB is the scene's own file (ctx.file), under a key that
//   names the game, the kind and a hash of what the GLB is drawn from
//   (pieces.js glbKey, which carries GEOMETRY_VERSION): new art gets a new
//   key, and a table made with the old keeps its own. So the table stands
//   alone, and doesn't redraw when the game's art changes. (The game page's
//   tables share the game's GLBs, which do.)
// - What a hidden card really is goes to a keeper, found in the registry by
//   kind (made-with.js): a `secure` deck to a joint keeper (the players
//   shuffle it between them), else to a plain one, which plays the same but
//   whose container anyone can read by opening it, and the maker is told so.
//   The seats are laid by whoever owns seats. With no keeper installed at
//   all, nothing is laid out and the maker is told why.
//
// Order: the files, then the decks' containers, then one change that writes
// the table (objects, seats, view, and `view.activity` "play" where the
// table has hands or cards); the stage then starts its maker where the
// doc says (STAGE.md, "Templates"): Lost Cities in play, Santorini (nothing
// there for play to run) in the editor, with the hand.

import { glbKey } from "../pieces.js";
import { glbFile } from "./files.js";
import { kindsUsed, placeLayout, tableLayout, writeTable } from "../setup.js";
import { containDecks, findSeats } from "./made-with.js";
import * as lostCitiesGame from "../games/lost-cities.js";
import * as santoriniGame from "../games/santorini.js";

const UNTITLED = "Untitled scene"; // the scene datatype's init title

/** 32-bit FNV-1a, as 8 hex digits. */
export function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The scene's assets key for a game kind's GLB: "tabletop/lost-cities/back@1a2b3c4d". (A part's: parts.js partKey.) */
export const gameFileKey = (gameId, kind, piece) => `tabletop/${gameId}/${kind}@${fnv(glbKey(piece))}`;

/**
 * Lay a game's table out in the scene the drop context is for: at the root,
 * as a template does, or set down on something (`parent`, at `transform` in
 * its frame: the games' parts, parts.js), every piece under it and each
 * seat's view in its frame (setup.js placeLayout). `view: false` leaves the
 * scene's view and title alone, for a table put into a scene that's already
 * something else (a ship).
 * @param {object} ctx      the stage's drop context (STAGE.md, "Drops")
 * @param {string} gameId   for the files' keys
 * @param {{ fill(d) }} game  the game's module
 * @param {{ rng?: () => number, parent?: string | null, transform?: object | null, view?: boolean }} [o]
 * @returns {Promise<object | null>} the layout written (null when its parent went meanwhile)
 */
export async function layOutTable(ctx, gameId, game, { rng = Math.random, parent = null, transform = null, view = true } = {}) {
  const g = {};
  game.fill(g);

  // the art: one file per kind, the scene's own
  const files = {};
  for (const kind of kindsUsed(g)) {
    const piece = g.pieces[kind];
    files[kind] = await ctx.file(gameFileKey(gameId, kind, piece), () => glbFile(piece));
  }

  const flat = tableLayout(g, { fileOf: (kind) => files[kind] ?? null, newId: ctx.newId, rng });
  const layout = parent || transform ? placeLayout(flat, { parent, transform }) : flat;
  const current = ctx.doc?.()?.title;
  const named = view && (!current || current === UNTITLED);
  const title = named ? `${g.title || "Game"} table` : current || `${g.title || "Game"} table`;

  // the containers first, so the scene never names one that isn't there
  let made;
  try {
    made = await containDecks({ repo: ctx.repo, registry: ctx.registry }, layout.decks, (deck) => `${title}: ${deck.title}`);
  } catch (err) {
    ctx.notify?.(String(err?.message ?? err), "error");
    return null;
  }
  const lay = Object.keys(layout.seats).length ? await findSeats(ctx.registry) : null;

  let put = false;
  ctx.change((d) => {
    // set down on something that went while the files were made: nothing
    if (parent && !d.objects?.[parent]) return;
    writeTable(d, layout, made.binds, { view, seats: lay });
    if (named) d.title = title;
    put = true;
  });
  if (!put) {
    ctx.notify?.("What that was put on has gone.");
    return null;
  }

  const fellBack = Object.entries(layout.decks).some(([deckId, deck]) => deck.secure && made.kinds[deckId] !== "joint");
  if (fellBack) ctx.notify?.("No keeper whose players shuffle is installed here, so this table's deck is kept in the open: anyone who opens it can read every hand.", "warn");
  if (Object.keys(layout.seats).length && !lay) ctx.notify?.("Nothing installed here owns seats, so this table has none.", "warn");
  if (Object.keys(layout.seats).length && lay) ctx.notify?.("Pick a seat (top right) to play.", "info");
  else ctx.notify?.(`${g.title || "The game"} is laid out. Carry the pieces with the hand.`, "info");
  return layout;
}

const template = (gameId, game) => ({
  async create(ctx) {
    await layOutTable(ctx, gameId, game);
  },
});

export const lostCities = template("lost-cities", lostCitiesGame);
export const santorini = template("santorini", santoriniGame);
