// What a table is made with: its containers, by a keeper (a `secure` deck
// by the joint keeper, whose players shuffle it between them; anything else
// by the plain one), its bags (bag/fill.js), and, found in the registry by
// what a plugin's metadata says it is (scene/STAGE.md, "Seats"):
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
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:extension")).catch(() => null) : null;
  if (!reg) return null;
  for (const p of listOf(reg)) {
    if (p?.roster !== true || typeof p.id !== "string") continue;
    const mod = await moduleOf(reg, p.id);
    if (typeof mod?.lay === "function") return mod.lay;
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
 * @returns {Promise<{ binds, kinds, bags: { [oid]: object }, seats: Function | null, notes: string[] }>}
 *   kinds: the keeper each container got ("joint", "plain"); seats: the seats owner's lay (writeTable
 *   lays the seats through it), null where there is none or the game has no seats.
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
  const seats = seated ? await findSeats(registry) : null;
  return { binds, kinds, bags, seats, notes: seated && !seats ? [NO_SEATS] : [] };
}

/** What a table writer says when the game has seats and nothing installed owns seats. */
export const NO_SEATS = "Nothing installed here owns seats, so this table has none.";

