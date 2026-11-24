// A session: a game description (a tabletop-game doc) rendered into a fresh
// scene doc, laid out as its recipe says for the options chosen. The game page's "Set up a
// table" and the launcher's New game are this, so they can't drift apart.
//
// Each kind shows the description's own GLB (`drawn`, pieces.js): what the
// table lays out is drawn first, a card's face when a keeper first shows it
// (`{ game, kind }` in its container), and web assets are cached in the
// description's `assets`, so every session made from one description shares
// both. A game with seats is never set up without them: where nothing here
// owns seats, the seats package is loaded first ("Loading seats…"), and
// nothing is made if it can't be (made-with.js seatsReady). Then the
// containers, bags and seats' owner (made-with.js
// prepareTable), so the scene never names one that isn't there; then the
// scene, written whole as the scene makes one (empty-scene.js), naming the
// packages it calls for (the scene's, the seats', this one's) and the scene
// package as its suggested import, whether or not they're installed here
// (scene-package.js namePackages); then the description lists it in `tables`.

import { kindsLaid, tableLayout, writeTable } from "../setup.js";
import { PUBLISHED, namePackages, packageUrls } from "../scene-package.js";
import { findSource, prepareTable, seatsReady } from "./made-with.js";
import { loadPackage as hostLoad } from "./load-package.js";
import { emptyScene } from "../empty-scene.js";
import { gameOf } from "../game.js";
import { pieceDrawer } from "../pieces.js";
import { defaultImages } from "../look/images.js";
import { errorText, validate } from "../../contract/v2/validate.js";
import { applyRecipe, optionsProblem } from "../../contract/v2/recipe.js";

/**
 * Set up a session of the game a doc holds.
 * @param {{
 *   repo: object, registry: (type: string) => Promise<object | null>, handle: object,
 *   options?: object, title?: string | null,
 *   draw?: (kinds: string[]) => Promise<unknown>, phase?: (text: string) => void, rng?: () => number,
 *   loadPackage?: (url: string, host: { repo: object }) => Promise<unknown>,
 * }} o  handle: the game doc's; options: its recipe's options' values (GAME-FORMAT.md §6; a default for each not given);
 *   title: the scene's (by default "<game> table <n>"); draw: draws these kinds into the game's `drawn`, throwing
 *   when it can't (by default a pieceDrawer of the game's own); phase: what it's doing now, for a status line;
 *   loadPackage: loads a package this viewer lacks and registers its plugins (by default load-package.js's)
 * @returns {Promise<{ url: string, notes: string[], layout: object }>}  the scene's url; what the maker is to be warned of
 */
export async function newSession({ repo, registry, handle, options = {}, title = null, draw = null, phase = () => {}, rng = Math.random, loadPackage = hostLoad }) {
  const game = gameOf(handle.doc());
  const checked = validate(game);
  if (!checked.ok) throw new Error(`the game isn't valid: ${errorText(checked)}`);
  const g = applyRecipe(game, options);
  if (!g) throw new Error(optionsProblem(game, options));
  // seats first: nothing is drawn or made for a table that can't have them
  if (Object.keys(g.seats ?? {}).length) await seatsReady({ repo, registry, phase, load: loadPackage, url: PUBLISHED.seats });
  // what the table lays out; a card's face is drawn when it's first shown
  const kinds = kindsLaid(g);
  if (draw) await draw(kinds);
  else await pieceDrawer({ repo, handle, images: defaultImages(), source: (type) => findSource(registry, type) }).ensure(kinds);
  const d = handle.doc();
  // each kind shows the game's own GLB, which redraws when the game changes
  const fileOf = (kind) => {
    const f = d.drawn?.[kind];
    return f?.url ? { url: f.url, hint: f.bounds ? { bounds: f.bounds } : null } : null;
  };
  phase("Laying out the table…");
  const layout = tableLayout(g, { fileOf, faceOf: (kind) => ({ game: handle.url, kind }), gameUrl: handle.url, rng });
  phase(`Making the table's ${Object.keys(layout.containers ?? {}).length} decks and ${Object.keys(layout.bags ?? {}).length} bags…`);
  const made = await prepareTable({ repo, registry }, layout);
  const table = emptyScene({ title: title ?? `${d.title || "Game"} table ${(d.tables?.length ?? 0) + 1}` });
  phase(`Writing the table (${layout.order.length} things)…`);
  writeTable(table, layout, made);
  namePackages(table, await packageUrls(made));
  const scene = await repo.create2(table);
  handle.change((x) => {
    if (!x.tables) x.tables = [];
    x.tables.push(scene.url);
  });
  return { url: scene.url, notes: made.notes, layout };
}
