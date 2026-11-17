// Starting and stopping view plugins (STAGE.md, "View plugins").
//
// A `scene:view` plugin runs once per view, for the view's whole life: every
// one registered starts as the view opens (load → module.create(api)) and
// stops only when it leaves the registry or the view closes. Nothing else
// starts or stops one: not the doc, not the focus, not what the viewer
// holds. What it acquires through its api is the view's business (view.js
// makeApi hands back the api with a release() that gives all of it back);
// what it acquires through a focus facet is the stage's (stage.js seats).
//
// Registry order is the only order anything here reports in.

const listOf = (reg) => {
  try {
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
};

/**
 * @param {{
 *   registry: () => Promise<object | null>,          // the scene:view registry
 *   makeApi: (rec: object) => { api: object, release: () => void },
 *   onChange?: () => void,                           // a plugin started or stopped
 * }} o
 */
export function createViewPlugins({ registry, makeApi, onChange = () => {} }) {
  let dead = false;
  let reg = null;
  let order = []; // registry order of what's registered
  // rec: { id, meta, state: "loading" | "running" | "failed" | "stopped", module, instance, api, release, controller, signal }
  const recs = new Map();
  const offs = [];

  const ready = Promise.resolve()
    .then(registry)
    .catch(() => null)
    .then((r) => {
      if (dead) return;
      reg = r ?? null;
      try {
        const off = reg?.on?.("changed", () => sync());
        if (typeof off === "function") offs.push(off);
      } catch {
        // a registry without change events: what's installed at open is what runs
      }
      sync();
    });

  function start(meta) {
    const rec = { id: meta.id, meta, state: "loading", module: null, instance: null, api: null, release: null, controller: null, signal: null };
    recs.set(meta.id, rec);
    (async () => {
      const loaded = await reg?.load?.(meta.id);
      const mod = loaded?.module?.default ?? loaded?.module;
      if (dead || rec.state !== "loading") return;
      if (typeof mod?.create !== "function") throw new Error("its module has no create()");
      rec.module = mod;
      rec.controller = new AbortController();
      rec.signal = rec.controller.signal;
      const made = makeApi(rec);
      rec.api = made.api;
      rec.release = made.release;
      try {
        rec.instance = mod.create(rec.api) ?? {};
      } catch (err) {
        teardown(rec);
        throw err;
      }
      rec.state = "running";
      onChange();
    })().catch((err) => {
      if (rec.state === "loading") rec.state = "failed";
      console.warn(`[scene] view plugin “${meta.id}” failed to start`, err);
    });
  }

  // The signal aborts first, so nothing it does from here acquires anything;
  // then the view gives back what it holds, then dispose.
  function teardown(rec) {
    rec.controller?.abort();
    try {
      rec.release?.();
    } catch (err) {
      console.warn(`[scene] view plugin “${rec.id}”: releasing what it held failed`, err);
    }
    if (rec.instance) {
      try {
        rec.instance.dispose?.();
      } catch (err) {
        console.warn(`[scene] view plugin “${rec.id}”: dispose failed`, err);
      }
    }
  }

  function stop(rec) {
    const was = rec.state;
    rec.state = "stopped";
    recs.delete(rec.id);
    if (was === "running") teardown(rec);
  }

  /** Start what's registered and not running; stop what left the registry. */
  function sync() {
    if (dead) return;
    const metas = listOf(reg).filter((m) => m?.id);
    const ids = new Set(metas.map((m) => m.id));
    let stopped = false;
    for (const rec of [...recs.values()])
      if (!ids.has(rec.id)) {
        stopped ||= rec.state === "running";
        stop(rec);
      }
    order = metas.map((m) => m.id);
    for (const m of metas) if (!recs.has(m.id)) start(m);
    if (stopped) onChange();
  }

  /** The started plugins, in registry order. @returns {{ id, meta, instance, api, signal }[]} */
  function running() {
    const out = [];
    for (const id of order) {
      const r = recs.get(id);
      if (r?.state === "running") out.push(r);
    }
    return out;
  }

  /** Stop everything (last first) and stop listening. */
  function dispose() {
    if (dead) return;
    for (const id of [...order].reverse()) {
      const r = recs.get(id);
      if (r) stop(r);
    }
    for (const r of [...recs.values()]) stop(r);
    dead = true;
    for (const off of offs) off();
    offs.length = 0;
  }

  return {
    ready,
    running,
    /** a started plugin's instance, or null */
    instanceOf: (id) => {
      const r = recs.get(id);
      return r?.state === "running" ? r.instance : null;
    },
    /** the record of a plugin being started or running (for probes and tests) */
    record: (id) => recs.get(id) ?? null,
    dispose,
  };
}
