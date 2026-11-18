// The game library, as data (pure). A library doc is folder-shaped,
// `{ title, docs: DocLink[] }` with DocLink = `{ name, type, url, icon? }`,
// so the sidebar and the folder tool read it as a folder; it holds two
// plain folder docs, linked with `type: "folder"`: Games (game
// descriptions: tabletop-game docs, built in or imported) and Sessions
// (scene docs, each a description rendered as one of its variants, or a
// fork of another session). The launcher (tool.js) reads and writes it
// through these.

import { cleanObject, cleanTraits } from "./copy-rule.js";

export const GAMES = "Games";
export const SESSIONS = "Sessions";
export const GAME_TYPE = "tabletop-game";
export const SCENE_TYPE = "scene";
export const FOLDER_TYPE = "folder";
/** The trait that makes an object a bag, naming its bag doc (bag/part.js CONTAINER). */
export const BAG_TRAIT = "bag.container";

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const isUrl = (v) => typeof v === "string" && v.startsWith("automerge:");

/** A folder's links, as plain `{ name, type, url }` (an ImmutableString read as a string), those with a doc's URL. */
export function linksOf(folder) {
  const out = [];
  for (const l of Array.isArray(folder?.docs) ? folder.docs : []) {
    const url = str(l?.url);
    if (!isUrl(url)) continue;
    out.push({ name: str(l.name) || "Untitled", type: str(l.type), url });
  }
  return out;
}

/** The library's Games and Sessions folders: the first folder link of each name, else null. */
export function foldersOf(library) {
  const folders = linksOf(library).filter((l) => l.type === FOLDER_TYPE);
  return { games: folders.find((l) => l.name === GAMES)?.url ?? null, sessions: folders.find((l) => l.name === SESSIONS)?.url ?? null };
}

/** A folder's game descriptions, in its order. */
export const gamesIn = (folder) => linksOf(folder).filter((l) => l.type === GAME_TYPE);

/** A folder's sessions, newest first: links are appended, so the last is the newest. */
export const sessionsIn = (folder) => linksOf(folder).filter((l) => l.type === SCENE_TYPE).reverse();

const two = (n) => String(n).padStart(2, "0");

/** A session's name: the game, how it's set up (a variant's name, if it has variants) and when it started, local time. */
export function sessionName(title, date = new Date(), variant = null) {
  const when = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
  return `${title || "Game"}${variant ? ` (${variant})` : ""}, ${when}`;
}

/** A fork's name. */
export const forkName = (name) => `${name || "Session"} (copy)`;

/**
 * The registered games a library hasn't a description of yet: those whose
 * id no description's `origin.builtIn` names, in registry order.
 * @param {{ id: string }[]} plugins  the `tabletop:game` plugins
 * @param {object[]} descriptions  the docs in Games
 */
export function missingBuiltIns(plugins, descriptions) {
  const have = new Set(descriptions.map((d) => d?.origin?.builtIn).filter((id) => typeof id === "string"));
  return plugins.filter((p) => typeof p?.id === "string" && !have.has(p.id));
}

/**
 * A description doc for a registered game, whole (for repo.create2): the
 * game, which registered game it is (`origin.builtIn`, so adding the built-in
 * games again adds none twice), and what a tabletop-game doc keeps beside the
 * game (datatype.js: `assets` made with it, `drawn`, `tables`).
 */
export function descriptionDoc(game, { builtIn, patchwork = { type: GAME_TYPE } }) {
  const g = plain(game);
  return { "@patchwork": plain(patchwork), ...g, origin: { ...(g.origin ?? {}), builtIn }, assets: g.assets ?? {}, drawn: {}, tables: [] };
}

/**
 * A session forked: the scene doc whole, by the scene's copy rule
 * (copy-rule.js): every object with its id; the stage's runtime fields,
 * runtime traits and fields (a keeper's binding: a card is a bare back) and
 * `copy: "drop"` fields left behind; every entries trait fresh (its seats
 * empty); a built object's render made again where it's opened (as a table
 * is written: `renderUrl: null`). Files are shared (immutable), and so is
 * the game a card's face is named by, so the copy draws from the same
 * description and its `assets` cache. A bag's things are the bag doc's, not
 * the scene's: `bags` lists each bag object's doc, which the caller copies
 * and names in the copy (`withBags`). It says where it came from:
 * `forkedFrom: { url, heads }`.
 * @param {object} doc  the session's scene doc
 * @param {{ rules: object, url: string, heads: string[] | null, title?: string }} o  rules: copy-rule.js copyRules
 * @returns {{ doc: object, bags: { id: string, url: string }[] }}
 */
export function forkScene(doc, { rules, url, heads, title = null }) {
  const out = plain(doc);
  const objects = {};
  for (const [id, o] of Object.entries(out.objects ?? {})) {
    const c = cleanObject(o, rules);
    if (typeof c.renderUrl === "string") c.renderUrl = null;
    objects[id] = c;
  }
  out.objects = objects;
  out.traits = cleanTraits(out.traits ?? {}, rules);
  out.title = title ?? forkName(str(doc?.title));
  out.forkedFrom = { url, heads: Array.isArray(heads) ? [...heads] : null };
  const bags = Object.entries(objects)
    .filter(([, o]) => isUrl(o.traits?.[BAG_TRAIT]?.doc))
    .map(([id, o]) => ({ id, url: o.traits[BAG_TRAIT].doc }));
  return { doc: out, bags };
}

/** A forked scene with each bag object naming its own copy of its bag doc: { [object id]: new bag url }. Pure. */
export function withBags(doc, copies) {
  const out = plain(doc);
  for (const [id, url] of Object.entries(copies ?? {})) if (out.objects?.[id]?.traits?.[BAG_TRAIT]) out.objects[id].traits[BAG_TRAIT].doc = url;
  return out;
}
