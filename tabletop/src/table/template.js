// A game's table laid out in a scene doc: an empty scene's start screen
// (`scene:template`), or a game dropped from the parts bin (`scene:part`,
// parts.js), which makes a game doc of its own, lays it out there and links
// it onto what it was put on (scene/EDITOR.md, "Extract and bundle"). Through the same
// writer as the game page's "Set up a table" (setup.js tableLayout +
// writeTable), so they can't drift apart. The table is always the whole
// doc's: its seats, title, view and origin are the doc's own.
//
// A game is found by its id among the registered `tabletop:game`s (this
// package's own are JSON files in games/; another package may register its
// own), and checked against the format (contract/v2/validate.js). Nothing
// here knows any one game (Liar's dice, under dice/, is laid out the same way).
//
// What differs from the game page's tables:
// - There is no game doc: nothing is the table's About.
// - Each kind's GLB is the scene's own file (ctx.file), under a key that
//   names what it's drawn from (files.js lookFileKey): new art gets a new
//   key, and a table made with the old keeps its own. So the table stands
//   alone, and doesn't redraw when the game's art changes.
// - What a card really is goes to a keeper (made-with.js): a `secure` deck
//   to the joint keeper (the players shuffle it between them), else to the
//   plain one, which plays the same but whose container anyone can read by
//   opening it. A bag's things go into a bag doc. The seats are laid by
//   whoever owns seats. What the maker is warned of comes with what the
//   table is made with (made-with.js prepareTable), so the game page's
//   status line says the same.
//
// Order: the files, then the containers and bags, then one change that
// writes the table (objects, seats, view: `view.start` in the seat body where
// the game has seats); the stage then starts its maker where the doc says
// (EDITOR.md, "Templates"): at Lost Cities watching from the first seat (every
// built-in game has seats; one without would start them in Look).

import { glbFile, lookFileKey } from "./files.js";
import { kindsUsed, tableLayout, writeTable } from "../setup.js";
import { findSource, prepareTable } from "./made-with.js";
import { defaultImages } from "../look/images.js";
import { readFile } from "../pieces.js";
import { errorText, validate } from "../../contract/v2/validate.js";
import { applyRecipe, optionsProblem } from "../../contract/v2/recipe.js";

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
 * Lay a game's table out in the doc a context is for (the stage's drop
 * context, EDITOR.md "Drops", or docContext's for a game doc of its own).
 * @param {object} ctx      { repo, registry, newId, doc, change, file, notify }
 * @param {string | object} game  a registered game's id, or a game
 * @param {{ options?: object, rng?: () => number, images?: object | null }} [o]  options: its recipe's options' values (GAME-FORMAT.md §6)
 * @returns {Promise<object | null>} the layout written (null when the game isn't there or isn't valid)
 */
export async function setUp(ctx, game, { options = {}, rng = Math.random, images = defaultImages() } = {}) {
  const found = typeof game === "string" ? await loadGame(ctx.registry, game) : game;
  if (!found) {
    ctx.notify?.(`There's no game “${game}” installed here.`, "error");
    return null;
  }
  const checked = validate(found);
  if (!checked.ok) {
    ctx.notify?.(`“${found.title ?? game}” isn't a game this can lay out: ${errorText(checked)}`, "error");
    return null;
  }
  const g = applyRecipe(found, options);
  if (!g) {
    ctx.notify?.(`“${found.title}” can't be set up so: ${optionsProblem(found, options)}.`, "error");
    return null;
  }

  // the art: one file per look, the scene's own
  const io = { read: (url) => readFile(ctx.repo, url), images, source: (type) => findSource(ctx.registry, type) };
  const files = {};
  for (const kind of kindsUsed(g)) {
    const piece = g.pieces[kind];
    files[kind] = await ctx.file(lookFileKey(piece), () => glbFile(piece, io));
  }

  const layout = tableLayout(g, { fileOf: (kind) => files[kind] ?? null, newId: ctx.newId, rng });
  const current = ctx.doc?.()?.title;
  const named = !current || current === UNTITLED;

  // the containers, bags and seats' owner first, so the scene never names one that isn't there
  const made = await prepareTable({ repo: ctx.repo, registry: ctx.registry }, layout);

  ctx.change((d) => {
    writeTable(d, layout, made);
    if (named) d.title = `${g.title || "Game"} table`;
  });

  for (const note of made.notes) ctx.notify?.(note, "warn");
  if (made.seats) ctx.notify?.("Pick a seat (top right) to play.", "info");
  else ctx.notify?.(`${g.title || "The game"} is laid out. Press a piece and drag it to carry it.`, "info");
  return layout;
}

/**
 * A context for a doc of its own (a game doc a part makes), as setUp takes
 * it: its reads and writes, and its own files (the doc's `assets`, as the
 * stage's ctx.file keeps a scene's), with the maker's repo, registry and notices.
 * @param {object} ctx  the maker's drop context  @param {object} handle  the doc's
 */
export function docContext(ctx, handle) {
  const making = new Map();
  const known = (key) => {
    const a = handle.doc()?.assets?.[key];
    return typeof a?.url === "string" ? { url: a.url, hint: a.hint ? JSON.parse(JSON.stringify(a.hint)) : null } : null;
  };
  return {
    repo: ctx.repo,
    registry: ctx.registry,
    newId: ctx.newId,
    notify: ctx.notify,
    url: handle.url,
    doc: () => handle.doc(),
    change: (fn) => handle.change(fn),
    async file(key, make) {
      const have = known(key);
      if (have) return have;
      if (!making.has(key))
        making.set(
          key,
          (async () => {
            const f = await make();
            const file = await ctx.repo.create2({ "@patchwork": { type: "file" }, name: String(f.name ?? key), extension: String(f.extension ?? ""), mimeType: String(f.mimeType ?? "application/octet-stream"), content: f.bytes });
            const hint = f.hint ? JSON.parse(JSON.stringify(f.hint)) : null;
            handle.change((d) => {
              if (!d.assets) d.assets = {};
              if (!d.assets[key]?.url) d.assets[key] = hint ? { url: file.url, hint } : { url: file.url };
            });
            return known(key) ?? { url: file.url, hint };
          })(),
        );
      return making.get(key);
    },
  };
}

/**
 * A template that lays a registered game's table out in an empty scene, by
 * the game's id. Its params are the game's options (GAME-FORMAT.md §6: the
 * stage hands create exactly the params its metadata declares, coerced:
 * EDITOR.md "Templates").
 * @param {string} game
 */
export const template = (game) => ({
  async create(ctx, params = {}) {
    await setUp(ctx, game, { options: params });
  },
});
