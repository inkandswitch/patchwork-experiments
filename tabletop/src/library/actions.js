// What the launcher does to a library (tool.js is its page): each step
// writes the docs it makes whole, then links them in Games or Sessions in
// one change of that folder. Everything the host provides is passed in
// (`repo`, `registry`: made-with.js's shape), so it runs in vitest too.

import { GAME_TYPE, SCENE_TYPE, descriptionDoc, foldersOf, forkName, forkScene, gamesIn, missingBuiltIns, sessionName, withBags } from "./model.js";
import { copyRules, describesOf, cleanObject } from "./copy-rule.js";
import { newSession } from "../table/session.js";
import { importUrlOf, patchworkOf } from "../scene-package.js";
import { inside, putIn } from "../bag/contents.js";
import { newBag } from "../bag/datatype.js";
import { errorText, validate } from "../../contract/v2/validate.js";

/** Every plugin of a type in a registry (made-with.js's `registry`), in registry order. */
async function pluginsOf(registry, type) {
  try {
    const reg = await Promise.resolve(registry?.(type));
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

/** The library's two folders' handles: { games, sessions } (null where it hasn't the folder, or it can't be had). */
export async function foldersFor(repo, library) {
  const { games, sessions } = foldersOf(library.doc());
  const find = async (url) => (url ? await Promise.resolve(repo.find(url)).catch(() => null) : null);
  const [g, s] = await Promise.all([find(games), find(sessions)]);
  return { games: g, sessions: s };
}

/** Link a doc in a folder, at its end. */
const linkIn = (folder, link) =>
  folder.change((d) => {
    if (!Array.isArray(d.docs)) d.docs = [];
    d.docs.push(link);
  });

async function need(repo, library, which) {
  const f = (await foldersFor(repo, library))[which];
  if (!f) throw new Error(`this library has no ${which === "games" ? "Games" : "Sessions"} folder`);
  return f;
}

/**
 * Add a description of every registered game (`tabletop:game`) the library
 * hasn't one of yet (model.js missingBuiltIns): idempotent.
 * @returns {Promise<string[]>} the descriptions made, in registry order
 */
export async function addBuiltIns({ repo, registry, library }) {
  const games = await need(repo, library, "games");
  const have = await Promise.all(gamesIn(games.doc()).map(async (l) => (await Promise.resolve(repo.find(l.url)).catch(() => null))?.doc?.() ?? null));
  const missing = missingBuiltIns(await pluginsOf(registry, "tabletop:game"), have);
  if (!missing.length) return [];
  const reg = await Promise.resolve(registry("tabletop:game"));
  const patchwork = patchworkOf(GAME_TYPE, await importUrlOf(GAME_TYPE));
  const made = [];
  for (const p of missing) {
    const loaded = await reg.load(p.id);
    const game = loaded?.module?.default ?? loaded?.module;
    const checked = validate(game);
    if (!checked.ok) throw new Error(`“${p.name ?? p.id}” isn't a valid game: ${errorText(checked)}`);
    const h = await repo.create2(descriptionDoc(game, { builtIn: p.id, patchwork }));
    made.push({ name: game.title, type: GAME_TYPE, url: h.url });
  }
  // checked again as the folder is now: a library open twice adds each once (two at once may still both add)
  const now = await Promise.all(gamesIn(games.doc()).map(async (l) => (await Promise.resolve(repo.find(l.url)).catch(() => null))?.doc?.()?.origin?.builtIn));
  const fresh = made.filter((_, i) => !now.includes(missing[i].id));
  games.change((d) => {
    if (!Array.isArray(d.docs)) d.docs = [];
    d.docs.push(...fresh);
  });
  return fresh.map((l) => l.url);
}

/**
 * New game: a description rendered into a fresh scene as one of its
 * variants (table/session.js), linked in Sessions as the game and the date.
 * @returns {Promise<{ url: string, name: string, notes: string[] }>}
 */
export async function startSession({ repo, registry, library, game, variant = null, now = () => new Date(), phase, draw }) {
  const sessions = await need(repo, library, "sessions");
  const d = game.doc();
  const variants = Array.isArray(d?.variants) ? d.variants : [];
  // a game with variants is set up as one of them, the first unless told
  const which = variants.length ? (variant ?? 0) : null;
  const v = which == null ? null : typeof which === "number" ? variants[which] : variants.find((x) => x?.name === which);
  if (which != null && !v) throw new Error(`“${d?.title}” has no variant “${which}”`);
  const name = sessionName(d?.title, now(), variants.length > 1 ? v.name : null);
  const { url, notes } = await newSession({ repo, registry, handle: game, variant: which, title: name, phase, draw });
  linkIn(sessions, { name, type: SCENE_TYPE, url });
  return { url, name, notes };
}

/**
 * Fork: a session copied into a new scene doc by the scene's copy rule
 * (model.js forkScene), each bag's doc copied too (its things as they are,
 * by the same rule: a card in a bag is a bare back), linked in Sessions as
 * "<name> (copy)".
 * @param {{ name: string, url: string }} session  its link in Sessions
 * @returns {Promise<{ url: string, name: string }>}
 */
export async function forkSession({ repo, registry, library, session }) {
  const sessions = await need(repo, library, "sessions");
  const source = await repo.find(session.url);
  const rules = copyRules(describesOf(await pluginsOf(registry, "scene:extension")));
  const name = forkName(session.name);
  const heads = typeof source.heads === "function" ? source.heads() : null;
  const plan = forkScene(source.doc(), { rules, url: session.url, heads, title: name });
  const copies = {};
  for (const { id, url } of plan.bags) {
    const bag = (await Promise.resolve(repo.find(url)).catch(() => null))?.doc?.();
    if (!bag) continue;
    const doc = newBag({ "@patchwork": JSON.parse(JSON.stringify(bag["@patchwork"] ?? { type: "bag" })), title: bag.title, look: JSON.parse(JSON.stringify(bag.look ?? {})), rule: bag.rule });
    // put in from no scene, as a table's setup fills one (bag/fill.js)
    putIn(
      doc,
      inside(bag).map(({ entry }) => ({ id: entry.id, object: cleanObject(entry.object, rules), scale: entry.scale })),
    );
    copies[id] = (await repo.create2(doc)).url;
  }
  const h = await repo.create2(withBags(plan.doc, copies));
  linkIn(sessions, { name, type: SCENE_TYPE, url: h.url });
  return { url: h.url, name };
}

/**
 * Import: a TTS mod (its JSON, with whatever cached assets came with it) →
 * the importer, with its settings (tts/settings.js: assets fetched when
 * first drawn unless `fetchNow`) → a tabletop-game, linked in Games.
 * @param {{ repo, library, sources: object[], settings?: object, fetch?: Function | null, onProgress?: Function, shrink?: Function | null }} o
 * @returns {Promise<{ url: string, name: string, report: object }>}
 */
export async function importGame({ repo, library, sources, settings = {}, fetch = null, onProgress, shrink }) {
  const games = await need(repo, library, "games");
  const { runImport } = await import("../tts/importer.js");
  const { gameUrl, report, game } = await runImport({ sources, repo, fetch, settings, onProgress, ...(shrink !== undefined ? { shrink } : {}) });
  const name = game?.title || report?.mod?.saveName || "Imported game";
  linkIn(games, { name, type: GAME_TYPE, url: gameUrl });
  return { url: gameUrl, name, report };
}
