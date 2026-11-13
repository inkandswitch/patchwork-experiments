// What a table is made with, found in the registry by what a plugin's
// metadata says it is, never by its package or id (packages don't know each
// other; scene/STAGE.md, "Keepers" and "Seats"):
//
//   - a keeper (`scene:extension`): the plugin whose `keeper` is the kind
//     wanted ("joint", "plain"). Its module's `contain({ repo }, { title,
//     items })` makes a container and returns { key, bind(slot) → traits }.
//   - a bag maker (`scene:extension`): the plugin whose `container` is
//     "bag" (the bag package's). Its module's `fill({ repo }, { title, rule,
//     items: [{ id, object }] })` makes a bag document holding those scene
//     objects and returns { url, traits }: the traits that make an object
//     that bag.
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

/**
 * The first keeper of one of these kinds that's installed, in the order
 * asked: { kind, contain } | null.
 * @param {(type: string) => Promise<object | null>} registry
 * @param {string[]} kinds  e.g. ["joint", "plain"]
 */
export async function findKeeper(registry, kinds) {
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:extension")).catch(() => null) : null;
  if (!reg) return null;
  for (const kind of kinds) {
    for (const p of listOf(reg)) {
      if (p?.keeper !== kind || typeof p.id !== "string") continue;
      const mod = await moduleOf(reg, p.id);
      if (typeof mod?.contain === "function") return { kind, contain: mod.contain };
    }
  }
  return null;
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

/** The bag maker's `fill`, or null where nothing installed here holds a bag's contents. */
export async function findBagMaker(registry) {
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:extension")).catch(() => null) : null;
  if (!reg) return null;
  for (const p of listOf(reg)) {
    if (p?.container !== "bag" || typeof p.id !== "string") continue;
    const mod = await moduleOf(reg, p.id);
    if (typeof mod?.fill === "function") return mod.fill;
  }
  return null;
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
 * A container for each of a layout's containers (setup.js tableLayout's
 * `containers`), made with the keeper each asks for: a `secure` one by a
 * joint keeper where one is installed, else, like any other, by a plain one.
 * @param {{ repo: object, registry: (type: string) => Promise<object | null> }} host
 * @param {{ [key]: { title: string, secure: boolean, items: any[] } }} containers
 * @returns {Promise<{ binds: { [key]: (slot: number) => object }, kinds: { [key]: string } }>}
 *   kinds: the keeper each got ("joint", "plain"). Throws when one has no keeper to go to.
 */
export async function containDecks({ repo, registry }, containers) {
  const binds = {};
  const kinds = {};
  const found = new Map(); // wanted kinds → keeper
  for (const [key, c] of Object.entries(containers ?? {})) {
    const want = c.secure ? ["joint", "plain"] : ["plain"];
    const k = want.join("|");
    if (!found.has(k)) found.set(k, await findKeeper(registry, want));
    const keeper = found.get(k);
    if (!keeper) throw new Error(`“${c.title}” has cards in it, and nothing installed here keeps them: add a keeper package`);
    const made = await keeper.contain({ repo }, { title: c.title, items: c.items });
    if (typeof made?.bind !== "function") throw new Error(`the ${keeper.kind} keeper made no container for “${c.title}”`);
    binds[key] = made.bind;
    kinds[key] = keeper.kind;
  }
  return { binds, kinds };
}

/**
 * Everything a layout holds, made before the table is written, so the scene
 * never names a document that isn't there: its containers (by keepers), then
 * its bags (by the bag maker, the innermost first, each holding its things
 * already bound: a card in a bag is still kept). Without a bag maker the
 * bags are written empty and a note says so.
 * @returns {Promise<{ binds, kinds, bags: { [oid]: object }, notes: string[] }>}
 */
export async function makeHolders({ repo, registry }, layout) {
  const { binds, kinds } = await containDecks({ repo, registry }, layout.containers);
  const bags = {};
  const notes = [];
  const ids = Object.keys(layout.bags ?? {});
  const fill = ids.length ? await findBagMaker(registry) : null;
  if (ids.length && !fill) {
    const n = ids.reduce((s, id) => s + layout.bags[id].items.length, 0);
    if (n) notes.push(`${n} thing${n === 1 ? "" : "s"} in bags weren't laid out: nothing installed here holds a bag's contents`);
  } else
    for (const id of ids.reverse()) {
      const bag = layout.bags[id];
      const items = bag.items.map(({ id: oid, object }) => ({ id: oid, object: bound(oid, object, { binds, bags }) }));
      const made = await fill({ repo }, { title: bag.title, rule: bag.rule, items });
      if (made?.traits) bags[id] = made.traits;
    }
  return { binds, kinds, bags, notes };
}
