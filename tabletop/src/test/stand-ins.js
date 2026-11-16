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
      // adds them; an id already there is written as <id>-2, -3, … (another table's); says where each went
      lay(d, seats) {
        const out = {};
        for (const [id, s] of Object.entries(seats ?? {})) {
          d.traits[SEATS] ??= {};
          let to = id;
          for (let n = 2; d.traits[SEATS][to]; n++) to = `${id}-${n}`;
          d.traits[SEATS][to] = { name: s.name || id, player: null, ...(s.camera ? { camera: structuredClone(s.camera) } : {}) };
          out[id] = to;
        }
        return out;
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
  // the seats whose view is in the nearest frame up each object's parents (the world's last)
  around: (scene, ids) => {
    const all = Object.entries(scene?.traits?.[SEATS] ?? {});
    const objects = scene?.objects ?? {};
    const frame = (s) => (s?.camera?.in && objects[s.camera.in] ? s.camera.in : null);
    const frames = new Set(all.map(([, s]) => frame(s)));
    const at = new Set();
    for (const id of ids) {
      let f;
      for (let x = id; x && objects[x]; x = objects[x].parent) if (frames.has(x)) { f = x; break; }
      at.add(f === undefined ? null : f);
    }
    return roster.seats(scene).filter((s) => at.has(frame(scene.traits[SEATS][s.id])));
  },
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

/** The stand-in bag maker's trait: what makes an object one of its bags. */
export const BAG = "t.bag";

/**
 * A bag maker, as a `scene:extension` plugin: found by `container: "bag"`,
 * its module's `fill({ repo }, { title, rule, items })` making a bag doc
 * ({ title, rule, items }) and returning the trait that makes an object it.
 */
export function bagPlugin() {
  return {
    type: "scene:extension",
    id: "t.bag",
    container: "bag",
    traits: [BAG],
    load: async () => ({
      create: () => ({}),
      async fill({ repo }, { title, rule, items }) {
        const h = await repo.create2({ "@patchwork": { type: "t-bag" }, title, rule, items: structuredClone(items) });
        return { url: h.url, traits: { [BAG]: { doc: h.url } } };
      },
    }),
  };
}

/** What draws documents of `type` in a scene, as a `scene:source` plugin: a GLB that says which doc it drew. */
export function sourcePlugin(type, glb = (doc) => new TextEncoder().encode(`glb of ${JSON.stringify(doc)}`)) {
  return {
    type: "scene:source",
    id: `t.source-${type}`,
    supportedDatatypes: [type],
    load: async () => ({
      async build({ doc }) {
        return { kind: "glb", glb: glb(doc), meta: { bounds: { min: [-0.01, 0, -0.01], max: [0.01, 0.02, 0.01] } } };
      },
    }),
  };
}

/** The registries a drop context or the game page finds these in, each plugin under its own type. */
export function registries(...plugins) {
  const byType = {};
  for (const p of plugins) (byType[p.type] ??= []).push(p);
  return Object.fromEntries(Object.entries(byType).map(([t, list]) => [t, fakeRegistry(list)]));
}

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

/**
 * What the stage's content(id).extras holds for a GLB with these extras on
 * its root (scene/STAGE.md `content(id)`, scene/src/carry-rules.js
 * sanitizeConnectors and placeConnector, copied): each connector cleaned,
 * its whole frame (`rotation`) kept with its yaw derived from it, else the
 * yaw it gives, or none. The rest as the GLB has it.
 */
export function stageExtras(extras) {
  const finite = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => Number.isFinite(Number(x)));
  const yawOfEuler = ([x, y]) => (Math.hypot(Math.sin(y), Math.cos(x) * Math.cos(y)) < 1e-6 ? null : Math.atan2(Math.sin(y), Math.cos(x) * Math.cos(y)));
  const connectors = (extras?.connectors ?? []).flatMap((c) => {
    const position = Array.isArray(c) ? c : c?.position;
    if (!finite(position)) return [];
    const rotation = !Array.isArray(c) && finite(c.rotation) ? c.rotation.slice(0, 3).map(Number) : null;
    const yaw = rotation ? yawOfEuler(rotation) : Array.isArray(c) || c.yaw == null ? null : Number(c.yaw);
    const tags = !Array.isArray(c) && Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string" && t) : [];
    return [{ position: position.slice(0, 3).map(Number), rotation, yaw, tags }];
  });
  return { ...extras, connectors };
}
