// A game's table laid out in a scene from inside it: an empty scene's start
// screen (`scene:template`) or a game dropped from the parts bin
// (`scene:part`, parts.js), through the same writer as the game page's "Set
// up a table" (setup.js tableLayout + writeTable), so they can't drift apart.
//
// A game is found by its id among the registered `tabletop:game`s (this
// package's own are JSON files in games/; another package may register its
// own), and checked against the format (contract/v1/validate.js). Nothing
// here knows any one game. Another package lays a game out the same way
// through the `tables` convention: the `tabletop` scene:extension's
// metadata says `tables: "tabletop-game"`, and its module's `setUp(ctx,
// gameId, options)` is setUp below (the dice package's Liar's dice).
//
// What differs from the game page's tables:
// - There is no game doc: nothing is the table's About.
// - Each kind's GLB is the scene's own file (ctx.file), under a key that
//   names what it's drawn from (files.js lookFileKey): new art gets a new
//   key, and a table made with the old keeps its own. So the table stands
//   alone, and doesn't redraw when the game's art changes.
// - What a card really is goes to a keeper, found in the registry by kind
//   (made-with.js): a `secure` deck to a joint keeper (the players shuffle
//   it between them), else to a plain one, which plays the same but whose
//   container anyone can read by opening it, and the maker is told so. A
//   bag's things go to a bag maker. The seats are laid by whoever owns
//   seats. With no keeper installed at all for a game with cards, nothing
//   is laid out and the maker is told why.
//
// Order: the files, then the containers and bags, then one change that
// writes the table (objects, seats, view: `view.activity` "play" where the
// game has seats); the stage then starts its maker where the doc says
// (STAGE.md, "Templates"): Lost Cities in play, Santorini in the editor.

import { glbFile, lookFileKey } from "./files.js";
import { kindsUsed, placeLayout, tableLayout, writeTable } from "../setup.js";
import { findSeats, findSource, makeHolders } from "./made-with.js";
import { defaultImages } from "../look/images.js";
import { readFile } from "../pieces.js";
import { errorText, validate } from "../../contract/v1/validate.js";

const UNTITLED = "Untitled scene"; // the scene datatype's init title

/** A registered game, by id: its JSON (`tabletop:game` plugins load to it), or null. */
export async function loadGame(registry, gameId) {
  try {
    const reg = await Promise.resolve(registry?.("tabletop:game"));
    const loaded = await reg?.load?.(gameId);
    const g = loaded?.module?.default ?? loaded?.module ?? null;
    return g && typeof g === "object" ? g : null;
  } catch (err) {
    console.warn(`[tabletop] couldn't load the game “${gameId}”`, err);
    return null;
  }
}

/**
 * Lay a game's table out in the scene the drop context is for: at the root,
 * as a template does, or set down on something (`parent`, at `transform` in
 * its frame: the games' parts), every piece under it and each seat's view in
 * its frame (setup.js placeLayout). `view: false` leaves the scene's view,
 * title and origin alone, for a table put into a scene that's already
 * something else (a ship).
 * @param {object} ctx      the stage's drop context (STAGE.md, "Drops")
 * @param {string | object} game  a registered game's id, or a game
 * @param {{ rng?: () => number, parent?: string | null, transform?: object | null, view?: boolean, images?: object | null }} [o]
 * @returns {Promise<object | null>} the layout written (null when the game isn't there or isn't valid,
 *   nothing keeps its cards, or its parent went meanwhile)
 */
export async function setUp(ctx, game, { rng = Math.random, parent = null, transform = null, view = true, images = defaultImages() } = {}) {
  const g = typeof game === "string" ? await loadGame(ctx.registry, game) : game;
  if (!g) {
    ctx.notify?.(`There's no game “${game}” installed here.`, "error");
    return null;
  }
  const checked = validate(g);
  if (!checked.ok) {
    ctx.notify?.(`“${g.title ?? game}” isn't a game this can lay out: ${errorText(checked)}`, "error");
    return null;
  }

  // the art: one file per look, the scene's own
  const io = { read: (url) => readFile(ctx.repo, url), images, source: (type) => findSource(ctx.registry, type) };
  const files = {};
  for (const kind of kindsUsed(g)) {
    const piece = g.pieces[kind];
    files[kind] = await ctx.file(lookFileKey(piece), () => glbFile(piece, io));
  }

  const flat = tableLayout(g, { fileOf: (kind) => files[kind] ?? null, newId: ctx.newId, rng });
  const layout = parent || transform ? placeLayout(flat, { parent, transform }) : flat;
  const current = ctx.doc?.()?.title;
  const named = view && (!current || current === UNTITLED);

  // the containers and bags first, so the scene never names one that isn't there
  let made;
  try {
    made = await makeHolders({ repo: ctx.repo, registry: ctx.registry }, layout);
  } catch (err) {
    ctx.notify?.(String(err?.message ?? err), "error");
    return null;
  }
  const lay = Object.keys(layout.seats).length ? await findSeats(ctx.registry) : null;

  let put = false;
  ctx.change((d) => {
    // set down on something that went while the files were made: nothing
    if (parent && !d.objects?.[parent]) return;
    writeTable(d, layout, made, { view, seats: lay });
    if (named) d.title = `${g.title || "Game"} table`;
    put = true;
  });
  if (!put) {
    ctx.notify?.("What that was put on has gone.");
    return null;
  }

  for (const note of made.notes) ctx.notify?.(note, "warn");
  const fellBack = Object.entries(layout.containers).some(([key, c]) => c.secure && made.kinds[key] !== "joint");
  if (fellBack) ctx.notify?.("No keeper whose players shuffle is installed here, so this table's deck is kept in the open: anyone who opens it can read every hand.", "warn");
  if (Object.keys(layout.seats).length && !lay) ctx.notify?.("Nothing installed here owns seats, so this table has none.", "warn");
  if (Object.keys(layout.seats).length && lay) ctx.notify?.("Pick a seat (top right) to play.", "info");
  else ctx.notify?.(`${g.title || "The game"} is laid out. Carry the pieces with the hand.`, "info");
  return layout;
}

/** A template that lays a registered game's table out in an empty scene. */
export const template = (gameId) => ({
  async create(ctx) {
    await setUp(ctx, gameId);
  },
});
