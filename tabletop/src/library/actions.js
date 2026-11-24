// What the launcher does to a library (tool.js is its page): each step
// writes the docs it makes whole, then links them in Games or Sessions in
// one change of that folder. Everything the host provides is passed in
// (`repo`, `registry`: made-with.js's shape), so it runs in vitest too.

import { GAME_TYPE, SCENE_TYPE, descriptionDoc, extraBuiltIns, foldersOf, forkName, forkScene, gamesIn, missingBuiltIns, sessionName, withBags } from "./model.js";
import { copyRules, describesOf, cleanObject } from "./copy-rule.js";
import { newSession } from "../table/session.js";
import { importUrlOf, patchworkOf } from "../scene-package.js";
import { BAG, inside, putIn, shadowsFor } from "../bag/contents.js";
import { newBag } from "../bag/datatype.js";
import { errorText, validate } from "../../contract/v2/validate.js";
import { describeOptions, optionValues } from "../../contract/v2/recipe.js";

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
  const [g, s] = await Promise.all([games, sessions].map((url) => (url ? handleAt(repo, url) : null)));
  return { games: g, sessions: s };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const handleAt = (repo, url) => Promise.resolve(repo.find(url)).catch(() => null);
const docAt = async (repo, url) => (await handleAt(repo, url))?.doc?.() ?? null;

/** Link docs in a folder, at its end: list inserts, so links two people add at once are both kept. */
export const linkIn = (folder, ...links) =>
  folder.change((d) => {
    if (!Array.isArray(d.docs)) d.docs = [];
    d.docs.push(...links);
  });

async function need(repo, library, which) {
  const f = (await foldersFor(repo, library))[which];
  if (!f) throw new Error(`this library has no ${which === "games" ? "Games" : "Sessions"} folder`);
  return f;
}

/**
 * Add a description of every registered game (`tabletop:game`) the library
 * hasn't one of yet, then take out each link after the first to the same
 * game (model.js): idempotent, and two adds at once, here or merged from two
 * peers, settle on the same one of each by the next add at the latest.
 * @returns {Promise<string[]>} the descriptions made and kept, in registry order
 */
export async function addBuiltIns({ repo, registry, library }) {
  const games = await need(repo, library, "games");
  const builtInsNow = async () => new Map(await Promise.all(gamesIn(games.doc()).map(async (l) => [l.url, (await docAt(repo, l.url))?.origin?.builtIn])));
  const missing = missingBuiltIns(await pluginsOf(registry, "tabletop:game"), (await builtInsNow()).values());
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
  if (made.length) linkIn(games, ...made);
  const extra = new Set(extraBuiltIns(gamesIn(games.doc()), await builtInsNow()));
  if (extra.size)
    games.change((d) => {
      for (let i = d.docs.length - 1; i >= 0; i--) if (extra.has(String(d.docs[i]?.url))) d.docs.splice(i, 1);
    });
  return made.map((l) => l.url).filter((u) => !extra.has(u));
}

/**
 * New game: a description rendered into a fresh scene as its recipe lays it
 * out for these options (table/session.js; a default for each not given),
 * linked in Sessions as the game, the options and the date. A game with
 * seats where nothing owns seats loads the seats package first (`phase`
 * says so), and makes nothing if it can't.
 * @returns {Promise<{ url: string, name: string, notes: string[] }>}
 */
export async function startSession({ repo, registry, library, game, options = {}, now = () => new Date(), phase, draw, loadPackage }) {
  const sessions = await need(repo, library, "sessions");
  const d = game.doc();
  const values = optionValues(d, options);
  const name = sessionName(d?.title, now(), values ? describeOptions(d, values) : null);
  const { url, notes } = await newSession({ repo, registry, handle: game, options, title: name, phase, draw, loadPackage });
  linkIn(sessions, { name, type: SCENE_TYPE, url });
  return { url, name, notes };
}

/**
 * Fork: a session copied into a new scene doc (model.js forkScene), with a
 * copy of each built object's render doc and of each bag's doc (README.md,
 * "The library"), linked in Sessions as "<name> (copy)".
 * @param {{ name: string, url: string }} session  its link in Sessions
 * @returns {Promise<{ url: string, name: string }>}
 */
export async function forkSession({ repo, registry, library, session }) {
  const sessions = await need(repo, library, "sessions");
  const source = await repo.find(session.url);
  const rules = copyRules(describesOf(await pluginsOf(registry, "scene:extension")));
  const name = forkName(session.name);
  const heads = typeof source.heads === "function" ? source.heads() : null;
  const src = source.doc();
  const renders = new Map();
  for (const u of new Set(Object.values(src.objects ?? {}).map((o) => o?.renderUrl).filter((u) => typeof u === "string"))) {
    const r = await docAt(repo, u);
    if (r) renders.set(u, (await repo.create2({ ...plain(r), status: "idle", error: null })).url);
  }
  const plan = forkScene(src, { rules, url: session.url, heads, title: name, renders });
  // every bag gets a doc of its own; only a plain bag's contents are data anyone may read, and so copied
  const bags = await Promise.all(plan.bags.map(async (b) => ({ ...b, doc: await docAt(repo, b.url) })));
  const isPlain = (d) => d?.["@patchwork"]?.type === BAG;
  const shadows = shadowsFor(bags.filter((b) => isPlain(b.doc)), { sceneUrl: session.url, has: (id) => !!src.objects?.[id] });
  const copies = {};
  for (const { id, url, doc: bag } of bags) {
    const doc = newBag(isPlain(bag) ? { "@patchwork": plain(bag["@patchwork"]), title: bag.title, look: plain(bag.look ?? {}), rule: bag.rule } : {});
    if (isPlain(bag)) putIn(doc, inside(bag, shadows.get(url)).map(({ entry }) => ({ id: entry.id, from: entry.from, object: cleanObject(entry.object, rules), scale: entry.scale })));
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
