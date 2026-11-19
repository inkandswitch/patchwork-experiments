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
// open session, a pose held), so nobody's game is torn down under them by a
// peer's edit. One still loading stops at once, having acquired nothing, and
// so does one whose plugin left the registry (there is no code to keep).
//
// Running order (activeSet's order) is the only order anything here reports
// in: local.running, instances(), collect(). The order extensions finished
// loading in never counts.

import { activeSet } from "./activation.js";
import { PACKAGE_FIND_MS } from "./packages.js";

/** How long an extension the doc no longer calls for keeps running. */
export const LINGER_MS = 2_000;
/** While a lingering extension is busy, how often to look again. */
export const BUSY_RECHECK_MS = 250;
/** Where a plugin's registration came from (its importUrl, with the heads it was loaded at), or null. */
const sourceOf = (meta) => (typeof meta?.importUrl === "string" ? meta.importUrl : null);

/** What loadOwn gives back for a rec whose plugin was registered again from elsewhere while it loaded. */
const SUPERSEDED = Symbol("superseded");

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
 * The update flush (STAGE.md, "`instance`"): each instance's
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
 *   busy?: (id: string) => boolean,             // a body entered, the held tool or an open session
 *   onChange?: () => void,                      // an extension started or stopped
 *   first?: () => any,                          // awaited before each create (a stage: the view's providers started)
 *   lingerMs?: number,
 *   loadMs?: number,                            // how long a provider may take to start before it counts as failed
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
  loadMs = PACKAGE_FIND_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  wanted = (metas, d) => activeSet({ metas, doc: d }),
  first = () => null,
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

  // Created in running order (providers first: activation.js providersFirst), each once every one before it
  // (a provider's: those providing what it `uses`) and `first` have started or failed, so a create's api.use finds every service that runs.
  function start(w, before) {
    const rec = { id: w.id, meta: w.meta, scope: w.scope, source: sourceOf(w.meta), state: "loading", module: null, instance: null, api: null, release: null, controller: null, signal: null, linger: null };
    recs.set(w.id, rec);
    rec.started = (async () => {
      const loaded = await loadOwn(rec);
      if (loaded === SUPERSEDED) return;
      await Promise.all([first(), ...before.map((r) => r.started)]);
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
      const said = new Set(listOf(w.meta?.provides)), has = Object.keys(rec.instance.provides ?? {});
      for (const n of [...has.filter((n) => !said.has(n)), ...[...said].filter((n) => !has.includes(n))]) console.warn(`[scene] “${w.id}”: its metadata and instance differ on providing “${n}” (an undeclared one is ignored)`);
      rec.state = "running";
      publish();
      onChange();
    })().catch((err) => {
      if (rec.state === "loading") (rec.state = "failed"), (rec.error = String(err?.message ?? err));
      console.warn(`[scene] extension “${w.id}” failed to start`, err);
    });
    // a provider not started within the load timeout (its import never settled) counts as failed: nothing waits on it longer
    if (!listOf(w.meta?.provides).length) return;
    let timer = null;
    rec.started = Promise.race([rec.started, new Promise((r) => (timer = setTimer(r, loadMs)))]).then(() => {
      clearTimer(timer);
      if (rec.state === "loading") (rec.state = "failed"), (rec.error = `didn't start in ${loadMs} ms`), console.warn(`[scene] extension “${w.id}” didn't start in ${loadMs} ms`);
    });
  }

  /**
   * The module of the registration `rec` was started for (rec.source), and
   * no other: the registry's load(id) resolves to whatever is registered
   * under the id when its import settles, or to nothing when the id was
   * registered again meanwhile (a retired package and the one that took its
   * plugins over both register it; the module watcher registers a package
   * again at each version it loads). A load that brings back another
   * registration's module, or none while the id is still registered, is
   * never this rec's failure: if the registration is still rec's, load it
   * again; if it's another's, this rec is SUPERSEDED, and the sync that the
   * registration's "changed" asks for (asked here too, in case it came
   * first) starts a rec for it, which awaits its own load.
   */
  async function loadOwn(rec) {
    for (;;) {
      const was = registrationOf(rec.id);
      const loaded = await reg?.load?.(rec.id);
      if (dead || rec.state !== "loading") return SUPERSEDED;
      if (loaded && (rec.source == null || sourceOf(loaded) === rec.source)) return loaded;
      const now = registrationOf(rec.id);
      if (now && sourceOf(now) !== rec.source) {
        Promise.resolve().then(() => recs.get(rec.id) === rec && rec.state === "loading" && sync(lastDoc));
        return SUPERSEDED;
      }
      // registered again from the same source mid-load: load that one. Otherwise
      // (uninstalled, or nothing changed) what came back is what there is.
      if (!now || now === was || loaded) return loaded;
    }
  }
  const registrationOf = (id) => {
    try {
      return reg?.get?.(id) ?? listOf(reg).find((m) => m?.id === id) ?? null;
    } catch {
      return null;
    }
  };

  /** The facet of the first running provider declaring `name` (NATIVE.md, "Native services") made for `caller` ({ id, signal }), or null. */
  function use(name, caller) {
    for (const r of running()) {
      const make = listOf(r.meta?.provides).includes(name) ? r.instance?.provides?.[name] : null;
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

  /** Once every provider being started has started or failed: what a stage's host awaits before a create. */
  const providersStarted = () => ready.then(() => Promise.all([...recs.values()].filter((r) => listOf(r.meta?.provides).length).map((r) => r.started)));

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
      let rec = recs.get(w.id);
      // One that failed to start, or is still loading, from another
      // registration than its plugin's now (the module watcher registers a
      // package again at each version it loads, and the first may be one
      // cached from before a sync, written against another kernel; a retired
      // package registers ids its successor took over): that one starts
      // afresh, from the registration that's there now. Never one failed
      // from the same registration: it would only fail again.
      if ((rec?.state === "failed" || rec?.state === "loading") && rec.source !== sourceOf(w.meta)) {
        stop(rec);
        rec = undefined;
      }
      const uses = listOf(w.meta?.provides).length ? listOf(w.meta?.uses) : null; // (a provider waits only for what it uses)
      if (!rec) start(w, set.slice(0, i).flatMap((x) => (recs.get(x.id)?.state === "loading" && (!uses || listOf(x.meta?.provides).some((p) => uses.includes(p))) ? [recs.get(x.id)] : [])));
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
  /** What the doc calls for, of what's registered here, that failed to start (one may be an audience policy: then who may see what is unknown). */
  const failed = () => activeIds()?.filter((id) => recs.get(id)?.state === "failed") ?? [];
  /** Why each of failed() failed: { [id]: the error's message }. */
  const errors = () => Object.fromEntries(failed().map((id) => [id, recs.get(id)?.error ?? "failed"]));

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
    failed,
    errors,
    starting,
    running,
    instances,
    instanceOf,
    collect,
    use,
    providersStarted,
    inputOf,
    /** the record of an extension being started, running or lingering (for probes) */
    record: (id) => recs.get(id) ?? null,
    /** is this extension lingering after the doc stopped calling for it? */
    lingering: (id) => recs.get(id)?.linger != null,
    dispose,
  };
}
