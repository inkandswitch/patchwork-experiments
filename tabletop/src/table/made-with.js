// What a table is made with, found in the `scene:extension` registry by what
// a plugin's metadata says it is, never by its package or id (packages don't
// know each other; scene/STAGE.md, "Keepers" and "Seats"):
//
//   - a keeper: the plugin whose `keeper` is the kind wanted ("joint",
//     "plain"). Its module's `contain({ repo }, { title, items })` makes a
//     container and returns { key, bind(slot) → traits }.
//   - the seats' owner: the plugin with `roster: true`. Its module's
//     `lay(d, seats)` writes seats into a scene doc being set up.
//
// `registry` is what the stage's drop context hands a part or a template
// (`ctx.registry`): an async function of a plugin type. The game page, which
// isn't in a stage, reads the host's registry (hostRegistry).

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

/**
 * A container for each of a layout's decks (setup.js tableLayout's `decks`),
 * made with the keeper each asks for: a `secure` deck by a joint keeper
 * where one is installed, else, like any other deck, by a plain one.
 * @param {{ repo: object, registry: (type: string) => Promise<object | null> }} host
 * @param {{ [deckId]: { title: string, secure: boolean, items: any[] } }} decks
 * @param {(deck: object) => string} [titleOf]  the container's title
 * @returns {Promise<{ binds: { [deckId]: (slot: number) => object }, kinds: { [deckId]: string } }>}
 *   kinds: the keeper each deck got ("joint", "plain"). Throws when a deck has no keeper to go to.
 */
export async function containDecks({ repo, registry }, decks, titleOf = (deck) => deck.title) {
  const binds = {};
  const kinds = {};
  const found = new Map(); // wanted kinds → keeper
  for (const [deckId, deck] of Object.entries(decks ?? {})) {
    const want = deck.secure ? ["joint", "plain"] : ["plain"];
    const k = want.join("|");
    if (!found.has(k)) found.set(k, await findKeeper(registry, want));
    const keeper = found.get(k);
    if (!keeper) throw new Error(`“${deck.title}” has hidden cards, and nothing installed here keeps them: add a keeper package`);
    const made = await keeper.contain({ repo }, { title: titleOf(deck), items: deck.items });
    if (typeof made?.bind !== "function") throw new Error(`the ${keeper.kind} keeper made no container for “${deck.title}”`);
    binds[deckId] = made.bind;
    kinds[deckId] = keeper.kind;
  }
  return { binds, kinds };
}
