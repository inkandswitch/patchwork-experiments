// What a table is made with: its containers, by a keeper (a `secure` deck
// by the joint keeper, whose players shuffle it between them; anything else
// by the plain one), its bags (bag/fill.js), and, found in the registry by
// what a plugin's metadata says it is (scene/CONVENTIONS.md, "Seats"):
//
//   - the seats' owner (`scene:extension`): the plugin with `roster: true`.
//     Its module's `lay(d, seats)` writes seats into a scene doc being set up.
//   - whatever draws a document (`scene:source`): the plugin whose
//     `supportedDatatypes` has the document's type. Its module's
//     `build({ doc })` → { kind: "glb", glb, meta: { bounds } } draws a piece
//     given as a document (GAME-FORMAT.md §4: a die).
//
// `registry` is what the stage's drop context hands a part or a template
// (`ctx.registry`): an async function of a plugin type. The game page, which
// isn't in a stage, reads the host's registry (hostRegistry).

import { bound } from "../setup.js";
import { fill } from "../bag/fill.js";
import { contain as joint } from "../keep/joint-keeper.js";
import { contain as plain } from "../keep/plain-keeper.js";

/** Every plugin in a registry, in registry order. */
const listOf = (reg) => {
  try {
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
};

/** A plugin's module (what its load() resolves to; a default export if it has one), or null. */
async function moduleOf(reg, id) {
  try {
    const loaded = await reg.load(id);
    return loaded?.module?.default ?? loaded?.module ?? null;
  } catch (err) {
    console.warn(`[tabletop] couldn't load “${id}”`, err);
    return null;
  }
}

/** How to write seats into a scene doc (the seats owner's `lay(d, seats)`), or null where nothing owns seats. */
export async function findSeats(registry) {
  return (await seatsOwner(registry))?.lay ?? null;
}

/** The seats owner: its `lay` and who it is (`{ id, importUrl }`, from its metadata, for the scene's packages list), or null. */
async function seatsOwner(registry) {
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:extension")).catch(() => null) : null;
  if (!reg) return null;
  for (const p of listOf(reg)) {
    if (p?.roster !== true || typeof p.id !== "string") continue;
    const mod = await moduleOf(reg, p.id);
    if (typeof mod?.lay === "function") return { lay: mod.lay, by: { id: p.id, importUrl: typeof p.importUrl === "string" ? p.importUrl : null } };
  }
  return null;
}

/** The host's plugin registry as a drop context's `registry` (for the game page); answers null without a host. */
export async function hostRegistry(type) {
  try {
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    return getRegistry(type) ?? null;
  } catch {
    return null;
  }
}

/** What draws documents of `type` in a scene (a scene:source's module, with build), or null. */
export async function findSource(registry, type) {
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:source")).catch(() => null) : null;
  if (!reg) return null;
  for (const p of listOf(reg)) {
    if (!Array.isArray(p?.supportedDatatypes) || !p.supportedDatatypes.includes(type) || typeof p.id !== "string") continue;
    const mod = await moduleOf(reg, p.id);
    if (typeof mod?.build === "function") return mod;
  }
  return null;
}

/**
 * Everything a table is made with, made or found before it's written, so the
 * scene never names a document that isn't there: its containers (a `secure`
 * deck's by the joint keeper, any other by the plain one), then its bags
 * (the innermost first, each holding its things already bound: a card in a
 * bag is still kept), and whoever owns seats where the game has any. With
 * them, the warning every table writer owes the maker (the template's
 * notices, the game page's status line): seats in the game that nothing
 * owns. One step, so a writer can't make the table and leave it out.
 * @param {{ repo: object, registry: (type: string) => Promise<object | null> }} host
 * @param {ReturnType<import("../setup.js").tableLayout>} layout
 * @returns {Promise<{ binds, kinds, bags: { [oid]: object }, seats: Function | null, seatsBy: { id: string, importUrl: string | null } | null, notes: string[] }>}
 *   kinds: the keeper each container got ("joint", "plain"); seats: the seats owner's lay (writeTable
 *   lays the seats through it), null where there is none or the game has no seats; seatsBy: that
 *   owner (whose package the scene lists: scene-package.js packageUrls).
 */
export async function prepareTable({ repo, registry }, layout) {
  const binds = {};
  const kinds = {};
  for (const [key, c] of Object.entries(layout.containers ?? {})) {
    kinds[key] = c.secure ? "joint" : "plain";
    binds[key] = (await (c.secure ? joint : plain)({ repo }, { title: c.title, items: c.items })).bind;
  }
  const bags = {};
  for (const id of Object.keys(layout.bags ?? {}).reverse()) {
    const bag = layout.bags[id];
    const items = bag.items.map(({ id: oid, object }) => ({ id: oid, object: bound(oid, object, { binds, bags }) }));
    bags[id] = (await fill({ repo }, { title: bag.title, rule: bag.rule, items })).traits;
  }
  const seated = Object.keys(layout.seats ?? {}).length > 0;
  const owner = seated ? await seatsOwner(registry) : null;
  return { binds, kinds, bags, seats: owner?.lay ?? null, seatsBy: owner?.by ?? null, notes: seated && !owner ? [NO_SEATS] : [] };
}

/** What a table writer says when the game has seats and nothing installed owns seats. */
export const NO_SEATS = "Nothing installed here owns seats, so this table has none.";

/** What setting a table up says while it loads the seats package. */
export const LOADING_SEATS = "Loading seats…";

/**
 * Whoever owns seats, loading the seats package first where nothing here
 * does (a Patchwork with only this package installed): a game with seats is
 * never set up without them. Says LOADING_SEATS through `phase` while it
 * loads, and waits for the load; rejects, saying so, when the package can't
 * be loaded or lays no seats once it has.
 * @param {{ repo: object, registry: (type: string) => Promise<object | null>, phase?: (text: string) => void,
 *   load: (url: string, host: { repo: object }) => Promise<unknown>, url: string }} o
 *   load: loads a package and registers its plugins (load-package.js); url: the seats package's (scene-package.js PUBLISHED.seats)
 * @returns {Promise<{ lay: Function, by: { id: string, importUrl: string | null } }>}
 */
export async function seatsReady({ repo, registry, phase = () => {}, load, url }) {
  const here = await seatsOwner(registry);
  if (here) return here;
  phase(LOADING_SEATS);
  try {
    await load(url, { repo });
  } catch (err) {
    throw new Error(`it needs seats, and the seats package couldn't be loaded: ${err?.message ?? err}`);
  }
  const owner = await seatsOwner(registry);
  if (!owner) throw new Error("it needs seats, and the seats package, loaded, lays none");
  return owner;
}

