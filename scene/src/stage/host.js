// Starting and stopping extensions (STAGE.md, "Activation" and "Stopping"),
// and a view's plugins (STAGE.md, "View plugins": `wanted` is every one
// registered, so only the registry starts or stops one).
//
// The running set is a pure function of the registry's metadata and the doc
// (activation.js activeSet): nothing the viewer does changes it (H1).
// sync(doc) recomputes it, starts what's new (load → module.create(api)) and
// stops what's gone. What an extension acquires through its api is the
// stage's business: makeApi hands back the api together with a release()
// that gives all of it back, in the STAGE.md order. The host only decides
// when.
//
// One stop rule (H2): an extension the doc no longer calls for lingers for
// LINGER_MS, and for as long as it's busy (a body entered, the held tool, an
// open session, a pose hold), so nobody's game is torn down under them by a
// peer's edit. One still loading stops at once, having acquired nothing, and
// so does one whose plugin left the registry (there is no code to keep).
//
// Running order (activeSet's order) is the only order anything here reports
// in: local.running, instances(), collect(). The order extensions finished
// loading in never counts.

import { activeSet } from "./activation.js";

/** How long an extension the doc no longer calls for keeps running. */
export const LINGER_MS = 2_000;
/** While a lingering extension is busy, how often to look again. */
export const BUSY_RECHECK_MS = 250;
const listOf = (reg) => {
  try {
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
};

/**
 * The new running order: `want` (activeSet's ids, in order), with each id
 * still lingering kept just after whatever preceded it last time. Pure.
 * @param {string[]} prev    last running order
 * @param {string[]} want    ids the running set calls for, in order
 * @param {Set<string>} lingering
 * @returns {string[]}
 */
export function mergeOrder(prev, want, lingering) {
  const out = [...want];
  for (let i = 0; i < prev.length; i++) {
    const id = prev[i];
    if (!lingering.has(id) || out.includes(id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(prev[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
  }
  return out;
}

/**
 * The update flush (STAGE.md, "Extensions"): each instance's
 * update(scene, local, prev, view) when any of the three is new to it
 * (`seen`: instance → what it was last told). What's shown changing in the
 * same flush as the doc or local state (`content`: a rebuilt GLB lands with
 * its status going back to idle) is said too, the one way the contract has
 * (prev === this scene, local and view), or a part that skips a status-only
 * change never sees the new box.
 * @param {{ id: string, instance: object }[]} list  @param {WeakMap} seen
 * @param {{ scene, local, view }} now  @param {boolean} content
 */
export function updateAll(list, seen, now, content) {
  for (const r of list) {
    const was = seen.get(r.instance);
    const changed = !was || was.scene !== now.scene || was.local !== now.local || was.view !== now.view;
    if (!changed && !content) continue;
    seen.set(r.instance, now);
    if (typeof r.instance.update !== "function") continue;
    try {
      r.instance.update(now.scene, now.local, was ?? { scene: null, local: null, view: null }, now.view);
      if (content && changed && was) r.instance.update(now.scene, now.local, now, now.view);
    } catch (err) {
      console.warn(`[scene] “${r.id}”: update failed`, err);
    }
  }
}

/** Every instance's `name` field that it has, in order. @returns {{ id: string, value: any }[]} */
export function collectFrom(list, name) {
  const out = [];
  for (const r of list) {
    let value;
    try {
      value = r.instance[name];
    } catch (err) {
      console.warn(`[scene] “${r.id}”: reading ${name} failed`, err);
      continue;
    }
    if (value !== undefined) out.push({ id: r.id, value });
  }
  return out;
}

/** Same list of { id, scope }? */
const sameRunning = (a, b) => Array.isArray(a) && a.length === b.length && a.every((r, i) => r.id === b[i].id && r.scope === b[i].scope);

/**
 * @param {{
 *   registry: () => Promise<object | null>,     // the scene:extension registry
 *   local?: { get(): object, swap(fn): object }, // the stage's local atom (local.running out)
 *   wanted?: (metas: object[], doc: object) => { id, meta, scope }[],  // the running set (activeSet)
 *   makeApi: (rec: object) => { api: object, release: () => void },
 *   busy?: (id: string) => boolean,             // a body entered, the held tool, an open session or a pose hold
 *   onChange?: () => void,                      // an extension started or stopped
 *   lingerMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} o
 */
export function createHost({
  registry,
  local,
  makeApi,
  busy = () => false,
  onChange = () => {},
  lingerMs = LINGER_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  wanted = (metas, d) => activeSet({ metas, doc: d }),
}) {
  let dead = false;
  let isReady = false;
  let reg = null;
  // rec: { id, meta, scope, state: "loading" | "running" | "failed" | "stopped",
  //        module (the loaded one, once loaded), instance, api, release, controller, signal, linger: timer | null }
  const recs = new Map();
  let order = []; // running order: every rec's id
  let lastDoc = null; // the doc the running set was last worked out for
  let pending = null; // a doc sync() was given before the registry arrived
  let syncing = false; // in sync(): a call from inside it (an extension's create writing the doc) runs after
  const offs = [];

  const ready = Promise.resolve()
    .then(registry)
    .catch(() => null)
    .then((r) => {
      if (dead) return;
      reg = r ?? null;
      isReady = true;
      try {
        const off = reg?.on?.("changed", () => sync(lastDoc));
        if (typeof off === "function") offs.push(off);
      } catch {
        // a registry without change events: what's installed at open is what runs
      }
      if (pending) {
        const d = pending;
        pending = null;
        sync(d);
      }
    });

  // ─── starting ─────────────────────────────────────────────────────────────

  // Created in running order: each once every one before it has started or failed, so a
  // provider is up before what comes after it asks for its service (api.use).
  function start(w, before) {
    const rec = { id: w.id, meta: w.meta, scope: w.scope, state: "loading", module: null, instance: null, api: null, release: null, controller: null, signal: null, linger: null };
    recs.set(w.id, rec);
    rec.started = (async () => {
      const loaded = await reg?.load?.(w.id);
      await Promise.all(before.map((r) => r.started));
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
      publish();
      onChange();
    })().catch((err) => {
      if (rec.state === "loading") rec.state = "failed";
      console.warn(`[scene] extension “${w.id}” failed to start`, err);
    });
  }

  /** The facet of the first running provider of `name` (STAGE.md, "Services") made for `caller` ({ id, signal }), or null. */
  function use(name, caller) {
    for (const r of running()) {
      const make = r.instance?.provides?.[name];
      if (typeof make !== "function") continue;
      try {
        return make(caller) ?? null;
      } catch (err) {
        console.warn(`[scene] “${r.id}”: providing ${name} failed`, err);
        return null;
      }
    }
    return null;
  }

  // ─── stopping ─────────────────────────────────────────────────────────────

  // The signal aborts first, so nothing it does from here acquires anything;
  // then the stage gives back what it holds (steps 1–7), then dispose (step 8).
  function teardown(rec) {
    rec.controller?.abort();
    try {
      rec.release?.();
    } catch (err) {
      console.warn(`[scene] extension “${rec.id}”: releasing what it held failed`, err);
    }
    if (rec.instance) {
      try {
        rec.instance.dispose?.();
      } catch (err) {
        console.warn(`[scene] extension “${rec.id}”: dispose failed`, err);
      }
    }
  }

  function stop(rec) {
    if (rec.linger != null) clearTimer(rec.linger);
    rec.linger = null;
    const was = rec.state;
    rec.state = "stopped";
    recs.delete(rec.id);
    order = order.filter((id) => id !== rec.id);
    if (was === "running") teardown(rec);
  }

  function linger(rec, ms = lingerMs) {
    if (rec.linger != null) return;
    const check = () => {
      rec.linger = null;
      if (dead || recs.get(rec.id) !== rec) return;
      if (isBusy(rec)) {
        rec.linger = setTimer(check, BUSY_RECHECK_MS);
        return;
      }
      stop(rec);
      publish();
      onChange();
    };
    rec.linger = setTimer(check, ms);
  }
  const isBusy = (rec) => {
    try {
      return rec.state === "running" && !!busy(rec.id);
    } catch {
      return false; // can't tell: let it go
    }
  };

  // ─── the running set ──────────────────────────────────────────────────────

  /** Recompute the running set for this doc: start what's new, stop what's gone. */
  function sync(doc) {
    if (dead) return;
    if (!isReady) {
      pending = doc ?? pending ?? {};
      return;
    }
    if (syncing) {
      pending = doc ?? pending ?? lastDoc ?? {};
      return;
    }
    syncing = true;
    try {
      syncNow(doc ?? lastDoc ?? {});
    } finally {
      syncing = false;
    }
    if (pending && !dead) {
      const d = pending;
      pending = null;
      sync(d);
    }
  }

  function syncNow(d) {
    const metas = listOf(reg);
    const set = wanted(metas, d);
    const registered = new Set(metas.map((m) => m?.id));
    const want = new Map(set.map((w) => [w.id, w]));
    for (const [i, w] of set.entries()) {
      const rec = recs.get(w.id);
      if (!rec) start(w, set.slice(0, i).flatMap((x) => (recs.get(x.id)?.state === "loading" ? [recs.get(x.id)] : [])));
      else {
        rec.meta = w.meta;
        rec.scope = w.scope;
        if (rec.linger != null) {
          clearTimer(rec.linger);
          rec.linger = null;
        }
      }
    }
    // the one stop rule: what the doc stopped calling for lingers. What's
    // still loading has nothing to give back, and an extension whose plugin
    // left the registry (uninstalled) has no code to come back to.
    let stopped = false;
    for (const rec of [...recs.values()]) {
      if (want.has(rec.id) || rec.linger != null) continue;
      if (rec.state === "running" && registered.has(rec.id)) linger(rec);
      else {
        stop(rec);
        stopped = true;
      }
    }
    const lingering = new Set([...recs.values()].filter((r) => r.linger != null).map((r) => r.id));
    order = mergeOrder(order, set.map((w) => w.id), lingering).filter((id) => recs.has(id));
    lastDoc = d;
    publish();
    if (stopped) onChange();
  }

  /** local.running: the started extensions, in running order. */
  function publish() {
    if (dead || !local) return;
    const next = running().map(({ id, scope }) => Object.freeze({ id, scope }));
    local.swap((m) => (sameRunning(m.running, next) ? m : { ...m, running: Object.freeze(next) }));
  }

  /** The started extensions, in running order. @returns {{ id, meta, scope }[]} */
  function running() {
    const out = [];
    for (const id of order) {
      const r = recs.get(id);
      if (r?.state === "running") out.push(r);
    }
    return out;
  }
  // ─── reading what's running ───────────────────────────────────────────────

  /** @returns {{ id, meta, scope, instance, api, signal }[]} started, in running order */
  const instances = () => running();

  /** @returns {object | null} a started extension's instance */
  const instanceOf = (id) => {
    const r = recs.get(id);
    return r?.state === "running" ? r.instance : null;
  };

  /**
   * Every running extension's `name` field, in running order.
   * @returns {{ id: string, value: any }[]}
   */
  const collect = (name) => collectFrom(running(), name);

  /** An extension's `input`, or undefined. */
  const inputOf = (id) => instanceOf(id)?.input ?? undefined;

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

  let settledFor = null; // { doc, n, ids }: what the registry as it is now would run for the last doc
  /** The ids the doc calls for, of what's registered now; null before there's a registry and a doc. */
  function activeIds() {
    if (!isReady || pending || !lastDoc) return null;
    // (worked out from the registry as it is now, not as it was at the last sync: a plugin
    // registered since, which no "changed" event has told of yet, isn't running either)
    const metas = listOf(reg);
    if (!settledFor || settledFor.doc !== lastDoc || settledFor.n !== metas.length) {
      settledFor = { doc: lastDoc, n: metas.length, ids: wanted(metas, lastDoc).map((w) => w.id) };
    }
    return settledFor.ids;
  }
  /**
   * Is everything the doc calls for, of what's registered here, started?
   * False before the registry is here, while a doc waits to be synced, and
   * while any extension is still loading or failed to start: one of those
   * may be a policy (`audience`), and the stage answers nothing about who
   * may see what until it's in.
   */
  function settled() {
    return activeIds()?.every((id) => recs.get(id)?.state === "running") ?? false;
  }

  /**
   * Is anything the doc calls for, of what's registered here, still on its
   * way (or the registry, or a doc waiting to be synced)? One that failed to
   * start isn't: it never settles the host, and nothing more comes of it
   * until the registry changes.
   */
  function starting() {
    return activeIds()?.some((id) => !["running", "failed"].includes(recs.get(id)?.state)) ?? true;
  }

  return {
    ready,
    sync,
    settled,
    starting,
    running,
    instances,
    instanceOf,
    collect,
    use,
    inputOf,
    /** the record of an extension being started, running or lingering (for probes) */
    record: (id) => recs.get(id) ?? null,
    /** is this extension lingering after the doc stopped calling for it? */
    lingering: (id) => recs.get(id)?.linger != null,
    dispose,
  };
}
