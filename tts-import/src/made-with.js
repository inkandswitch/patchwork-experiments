// What an imported table is made with, found in the `scene:extension`
// registry by what a plugin's metadata says it is, never by its package or
// id (scene/STAGE.md, "Keepers" and "Seats"):
//
//   - a keeper: the plugin whose `keeper` is the kind wanted ("plain"). Its
//     module's `contain({ repo }, { title, items })` makes a container and
//     returns { key, bind(slot) → traits }.
//   - the seats' owner: the plugin with `roster: true`. Its module's
//     `lay(d, seats)` writes seats into a scene doc being set up.
//
// (tabletop carries the same lookups: packages don't import each other.)

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
    console.warn(`[tts-import] couldn't load “${id}”`, err);
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
