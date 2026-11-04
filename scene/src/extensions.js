// Scene extensions: `scene:extension` plugins, which add behaviour to a scene
// without the scene knowing what it is for (see README, "Extensions"). The
// tabletop package's is one: seats, private zones, hidden cards and decks.
//
// Plugin metadata (worker-safe; code behind load()):
//   { type: "scene:extension", id, name,
//     traits?: string[],   // trait keys it owns: active when the scene or an object has one
//     legacy?: { scene?: string[], objects?: string[] },  // old top-level fields it upgrades: active when present
//     drops?: string[],    // datatypes it may lay out when dropped on the scene ("*": any)
//     always?: boolean }   // active in every scene
// load() resolves to { create(api) → instance }. See README for `api` and the
// instance's optional parts (migrate, update, looks, hud, panels, commands,
// drop, landing, dispose).

/** Does this scene doc call for the extension described by `meta`? */
export function wants(meta, d) {
  if (meta?.always) return true;
  const traits = new Set(Array.isArray(meta?.traits) ? meta.traits : []);
  const legacyScene = Array.isArray(meta?.legacy?.scene) ? meta.legacy.scene : [];
  const legacyObjects = Array.isArray(meta?.legacy?.objects) ? meta.legacy.objects : [];
  if (legacyScene.some((k) => d?.[k] != null)) return true;
  for (const k of Object.keys(d?.traits ?? {})) if (traits.has(k)) return true;
  for (const o of Object.values(d?.objects ?? {})) {
    if (!o) continue;
    if (legacyObjects.some((k) => o[k] != null)) return true;
    if (o.traits) for (const k of Object.keys(o.traits)) if (traits.has(k)) return true;
  }
  return false;
}

/** May this extension lay out a dropped doc of this datatype? */
export function takesDrop(meta, type) {
  const drops = Array.isArray(meta?.drops) ? meta.drops : [];
  return drops.includes("*") || (!!type && drops.includes(type));
}

/**
 * The extensions running in one scene tool.
 * @param {{ registry: () => Promise<object | null>, api: object, onActive: () => void }} o
 *   registry: the `scene:extension` registry (null without one); onActive: an
 *   extension has started (the tool syncs again so it sees the doc)
 */
export function createExtensionHost({ registry, api, onActive }) {
  const running = new Map(); // id → { meta, instance } (instance null while loading)
  let dead = false;

  async function start(meta) {
    if (running.has(meta.id)) return running.get(meta.id).ready;
    const rec = { meta, instance: null, ready: null };
    running.set(meta.id, rec);
    rec.ready = (async () => {
      const reg = await registry();
      const loaded = await reg?.load?.(meta.id);
      const mod = loaded?.module?.default ?? loaded?.module;
      if (dead || running.get(meta.id) !== rec || typeof mod?.create !== "function") return null;
      rec.instance = mod.create(api) ?? {};
      onActive?.();
      return rec.instance;
    })().catch((err) => {
      console.warn(`[scene] extension “${meta.id}” failed to start`, err);
      return null;
    });
    return rec.ready;
  }

  const list = async () => {
    const reg = await registry();
    try {
      return reg?.filter?.(() => true) ?? [];
    } catch {
      return [];
    }
  };

  return {
    /** Start whatever this doc calls for (extensions are never stopped while the tool is open). */
    async activate(d) {
      for (const meta of await list()) if (!running.has(meta.id) && wants(meta, d)) start(meta);
    },
    /** Start the extensions that may take a dropped doc of this datatype; resolves when they are running. */
    async forDrop(type) {
      const metas = (await list()).filter((m) => takesDrop(m, type));
      return (await Promise.all(metas.map(start))).filter(Boolean);
    },
    /** The running instances, in the order they started. */
    instances() {
      return [...running.values()].map((r) => r.instance).filter(Boolean);
    },
    dispose() {
      dead = true;
      for (const r of running.values()) {
        try {
          r.instance?.dispose?.();
        } catch (err) {
          console.warn("[scene] extension dispose failed", err);
        }
      }
      running.clear();
    },
  };
}
