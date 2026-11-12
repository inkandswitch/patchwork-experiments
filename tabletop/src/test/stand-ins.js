// Stand-ins, for tests, for what a table meets only through the stage and
// the registry: whoever owns seats, and keepers. Each is made the way the
// contract says (scene/STAGE.md, "Seats" and "Keepers") and names nothing
// of any real package: the seats live under a trait of the stand-in's own,
// and a keeper's trait is its own too. If a test passes with these, the
// table depends on the conventions and not on who provides them.

import { fakeRegistry } from "./fakes.js";

/** The stand-in seats owner's trait: the table never reads it; only this file does. */
export const SEATS = "t.seats";

/** A seats owner, as a `scene:extension` plugin: found by `roster: true`, its module's `lay(d, seats)`. */
export function seatsPlugin() {
  return {
    type: "scene:extension",
    id: "t.seats",
    roster: true,
    traits: [SEATS],
    load: async () => ({
      create: () => ({}),
      lay(d, seats) {
        if (d.traits[SEATS] || !Object.keys(seats ?? {}).length) return false;
        d.traits[SEATS] = Object.fromEntries(Object.entries(seats).map(([id, s]) => [id, { name: s.name || id, player: null, ...(s.camera ? { camera: structuredClone(s.camera) } : {}) }]));
        return true;
      },
    }),
  };
}

/** The `roster` convention over the stand-in's trait (what its instance would contribute). */
export const roster = Object.freeze({
  seats: (scene) => Object.entries(scene?.traits?.[SEATS] ?? {}).map(([id, s]) => ({ id, name: s?.name || id, viewer: s?.player || null })),
  viewers: (scene) => roster.seats(scene).map((s) => s.viewer).filter(Boolean),
  open: (scene) => roster.seats(scene).filter((s) => !s.viewer).map((s) => s.name),
  nameOf: (scene, v) => roster.seats(scene).find((s) => s.viewer === v)?.name ?? null,
  who: (v) => (v ? `<${v}>` : "Someone"),
});

/** A keeper's trait key, for a stand-in keeper of `kind`. */
export const keptTrait = (kind) => `t.${kind}`;

/**
 * A keeper, as a `scene:extension` plugin: found by `keeper: kind`, its
 * module's `contain({ repo }, { title, items })` making a container doc
 * ({ kind, title, items }) and binding objects by its own trait.
 */
export function keeperPlugin(kind) {
  const trait = keptTrait(kind);
  return {
    type: "scene:extension",
    id: `t.keep-${kind}`,
    keeper: kind,
    traits: [trait],
    load: async () => ({
      create: () => ({}),
      async contain({ repo }, { title, items }) {
        const h = await repo.create2({ "@patchwork": { type: `t-${kind}` }, title, items: structuredClone(items) });
        return { key: h.url, bind: (slot) => ({ [trait]: { by: h.url, slot } }) };
      },
    }),
  };
}

/** The registries a drop context or the game page finds these in. */
export const registries = (...plugins) => ({ "scene:extension": fakeRegistry(plugins) });

/** Which container and slot an object is kept in, whichever stand-in keeper keeps it: { kind, by, slot } | null. */
export function keptIn(o) {
  for (const [k, v] of Object.entries(o?.traits ?? {})) if (k.startsWith("t.") && k !== SEATS && v && typeof v.by === "string") return { kind: k.slice(2), by: v.by, slot: v.slot };
  return null;
}

/**
 * The `keeper` convention, for an extension test: every object with a
 * stand-in keeper's trait is kept, by container; shuffles are recorded.
 * @param {() => object} objects  the scene's objects, as they are now
 */
export function keeperOf(objects, { name = () => "Deck" } = {}) {
  const calls = [];
  return {
    calls,
    kind: "plain",
    of: (id) => keptIn(objects()[id])?.by ?? null,
    name,
    shuffle(ids) {
      calls.push([...ids]);
      return ids.length >= 2 ? ids.length : 0;
    },
  };
}
