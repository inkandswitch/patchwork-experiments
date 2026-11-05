// Starting and stopping extensions (STAGE.md, "Activation" and "Stopping").
//
// The running set is a pure function of the registry's metadata, the doc and
// what this viewer is doing (their activity: activation.js activeSet).
// sync(doc) recomputes it, starts
// what's new (load → module.create(api)) and stops what's gone. What an
// extension acquires through its api is the stage's business: makeApi hands
// back the api together with a release() that gives all of it back, in the
// STAGE.md order. The host only decides when.
//
// An extension that leaves because of the doc (a peer's undo took its trait
// away) lingers for LINGER_MS, and for as long as it's busy (an arm, an open
// session, a pose hold), so nobody's game is torn down under them. One that
// leaves because this viewer switched activity stops at once.
//
// The activity: local.activity is this viewer's (null until they join: the
// first doc with a view sets it to where the doc says to start, so a later
// change to that never moves someone already here). The one that runs is
// published as local.activities.current, with the ones on offer: it is
// local.activity when the scene offers it, else "edit" (currentActivity).
// Everything that needs to know what's being done reads it there.
//
// Running order (activeSet's order) is the only order anything here reports
// in: local.running, instances(), collect(). The order extensions finished
// loading in never counts.

import { DEFAULT_ACTIVITY, activeSet, availableActivities, currentActivity, takesDrop } from "./activation.js";

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

/** The same activities? */
const sameActivities = (a, b) => !!a && a.current === b.current && a.available.length === b.available.length && a.available.every((x, i) => x === b.available[i]);

/** Same list of { id, scope }? */
const sameRunning = (a, b) => Array.isArray(a) && a.length === b.length && a.every((r, i) => r.id === b[i].id && r.scope === b[i].scope);

/**
 * @param {{
 *   registry: () => Promise<object | null>,     // the scene:extension registry
 *   local: { get(): object, swap(fn): object }, // the stage's local atom (local.activity in; local.running and local.activities out)
 *   makeApi: (rec: object) => { api: object, release: () => void },
 *   makeDropContext?: (id: string) => object,
 *   busy?: (id: string) => boolean,             // an arm, an open session or a pose hold
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
  makeDropContext = () => ({}),
  busy = () => false,
  onChange = () => {},
  lingerMs = LINGER_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
}) {
  let dead = false;
  let isReady = false;
  let reg = null;
  // rec: { id, meta, scope, state: "loading" | "running" | "failed" | "stopped",
  //        instance, api, release, controller, signal, linger: timer | null }
  const recs = new Map();
  let order = []; // running order: every rec's id
  let lastDoc = null; // the doc the running set was last worked out for
  let pending = null; // a doc sync() was given before the registry arrived
  let syncing = false; // in sync(): a call from inside it (local.activity set on joining) runs after
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

  /** What runs for this doc, with this viewer's activity as it is now. */
  function wanted(metas, doc) {
    const available = availableActivities(metas, doc);
    const current = currentActivity(local.get().activity, doc, available);
    return { activities: { current, available }, set: activeSet({ metas, doc, activity: current }) };
  }

  // ─── starting ─────────────────────────────────────────────────────────────

  function start(w) {
    const rec = { id: w.id, meta: w.meta, scope: w.scope, state: "loading", instance: null, api: null, release: null, controller: null, signal: null, linger: null };
    recs.set(w.id, rec);
    (async () => {
      const loaded = await reg?.load?.(w.id);
      const mod = loaded?.module?.default ?? loaded?.module;
      if (dead || rec.state !== "loading") return;
      if (typeof mod?.create !== "function") throw new Error("its module has no create()");
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

  function linger(rec) {
    if (rec.linger != null) return;
    const check = () => {
      rec.linger = null;
      if (dead || recs.get(rec.id) !== rec) return;
      let isBusy = false;
      try {
        // busy itself, or something it requires is (the hand carrying a card
        // for the table): a requirer and what it requires are one gesture
        const group = [rec.id, ...(Array.isArray(rec.meta?.requires) ? rec.meta.requires : [])];
        isBusy = rec.state === "running" && group.some((id) => busy(id));
      } catch {
        // can't tell: let it go
      }
      if (isBusy) {
        rec.linger = setTimer(check, BUSY_RECHECK_MS);
        return;
      }
      stop(rec);
      publish();
      onChange();
    };
    rec.linger = setTimer(check, lingerMs);
  }

  // ─── the running set ──────────────────────────────────────────────────────

  /**
   * Recompute the running set for this doc (and the viewer's activity as it
   * is in local now): start what's new, stop what's gone.
   */
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
    // joining: this viewer starts where the doc says (once there is a doc)
    if (local.get().activity == null && d.view && typeof d.view === "object") {
      const start = typeof d.view.activity === "string" ? d.view.activity : DEFAULT_ACTIVITY;
      local.swap((m) => (m.activity != null ? m : { ...m, activity: start }));
    }
    const metas = listOf(reg);
    const { activities, set } = wanted(metas, d);
    const want = new Map(set.map((w) => [w.id, w]));
    for (const w of set) {
      const rec = recs.get(w.id);
      if (!rec) start(w);
      else {
        rec.meta = w.meta;
        rec.scope = w.scope;
        if (rec.linger != null) {
          clearTimer(rec.linger);
          rec.linger = null;
        }
      }
    }
    // Which of the gone ones did the doc send away? Those the previous doc,
    // with this viewer's activity as it is now, would still run.
    let docCaused = null;
    let stopped = false;
    for (const rec of [...recs.values()]) {
      if (want.has(rec.id) || rec.linger != null) continue;
      docCaused ??= new Set(wanted(metas, lastDoc ?? {}).set.map((w) => w.id));
      if (rec.state === "running" && docCaused.has(rec.id)) linger(rec);
      else {
        stop(rec);
        stopped = true;
      }
    }
    const lingering = new Set([...recs.values()].filter((r) => r.linger != null).map((r) => r.id));
    order = mergeOrder(order, set.map((w) => w.id), lingering).filter((id) => recs.has(id));
    lastDoc = d;
    local.swap((m) => (sameActivities(m.activities, activities) ? m : { ...m, activities: Object.freeze({ current: activities.current, available: Object.freeze(activities.available) }) }));
    publish();
    if (stopped) onChange();
  }

  /** local.running: the started extensions, in running order. */
  function publish() {
    if (dead) return;
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
  function collect(name) {
    const out = [];
    for (const r of running()) {
      let value;
      try {
        value = r.instance[name];
      } catch (err) {
        console.warn(`[scene] extension “${r.id}”: reading ${name} failed`, err);
        continue;
      }
      if (value !== undefined) out.push({ id: r.id, value });
    }
    return out;
  }

  /** An extension's `input`, or undefined. */
  const inputOf = (id) => instanceOf(id)?.input ?? undefined;

  /**
   * Lay out a dropped doc: load each module (registry order) whose `drops`
   * match its datatype and call its drop(ctx, info) until one says true.
   * Nothing is added to the running set here: the traits the drop writes
   * are what start the extension.
   * @param {{ url, doc, handle, group, at }} info
   * @returns {Promise<boolean>}
   */
  async function drop(info) {
    await ready;
    if (dead) return false;
    const type = info?.doc?.["@patchwork"]?.type ?? null;
    for (const meta of listOf(reg)) {
      if (!meta?.id || !takesDrop(meta, type)) continue;
      let mod;
      try {
        const loaded = await reg.load(meta.id);
        mod = loaded?.module?.default ?? loaded?.module;
      } catch (err) {
        console.warn(`[scene] extension “${meta.id}” failed to load`, err);
        continue;
      }
      if (dead) return false;
      if (typeof mod?.drop !== "function") continue;
      try {
        if (await mod.drop(makeDropContext(meta.id), info)) return true;
      } catch (err) {
        console.warn(`[scene] extension “${meta.id}”: drop failed`, err);
      }
      if (dead) return false;
    }
    return false;
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
    sync,
    running,
    instances,
    instanceOf,
    collect,
    inputOf,
    drop,
    /** the record of an extension being started, running or lingering (for probes) */
    record: (id) => recs.get(id) ?? null,
    /** is this extension lingering after the doc stopped calling for it? */
    lingering: (id) => recs.get(id)?.linger != null,
    dispose,
  };
}
