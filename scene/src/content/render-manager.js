// Keeps every built object of a stage built (README.md, "Content"): watches
// each object's source doc, its render doc and what its build reads, says
// its state (./state.js), builds it when that state wants a build and the
// lock (./lock.js) says this peer is the one, and hands the current GLB's
// bytes on to be drawn. It runs on the stage's time; no three.js here.
//
// An object fixed at a version (scene object `at`) is built from a read-only
// view of its source at those heads, and from views of the dependencies `at`
// lists; it is judged against those views, so edits to the live docs never
// make it stale. Params and provider versions still do.
//
// A read-only manager (`readOnly`: a pinned or refusing stage's, STAGE.md,
// "Read-only") says each object's state and shows what is built; it never
// claims, builds or writes.

import { fileBytes } from "../file-content.js";
import { dependenciesOf, dependencyKeyOf, errorMessage, fingerprintOf, runBuild, validBounds } from "./build.js";
import { knowsHeads, pinnedRepo, sortedHeads, viewAt } from "../versions.js";
import { changedKeys } from "../params.js";
import { createDependencyWatcher, retryWait } from "./deps.js";
import { handleReadOnly } from "../stage/readonly.js";
import { pageBus } from "../stage/presence.js";
import { atFromBuilt, atKey, builtInputsKey, debounceFor, inputsKey, normalizeAt, staleReason } from "./staleness.js";
import { contentState, wantsBuild } from "./state.js";
import { HEARTBEAT_MS, LAPSE_MS, LISTEN_MS, live, lockStep } from "./lock.js";

/** The lock's message on a render doc's channel: { type, from, n, key, phase: "claim" | "build" | "done" } (`n` counts up from each sender). */
export const CLAIM_MSG = "scene-render:claim";
/** A failed build is tried again after each of these, its inputs unchanged; then left until they change or someone asks. */
export const RETRY_BACKOFF_MS = Object.freeze([5_000, 30_000, 120_000]);

let managers = 0; // this page's managers, so two in one page have different ids

/** The inputs key without the dependencies in `pending`. */
const looseKey = (render, source, pending) => inputsKey(render, { ...source, deps: Object.fromEntries(Object.entries(source.deps ?? {}).filter(([u]) => !pending.has(u))) });

function parseKey(key) {
  try {
    return JSON.parse(key);
  } catch {
    return {};
  }
}

/**
 * @param {object} o
 * @param {object} o.repo
 * @param {object} o.time  the stage's time (stage/time.js): now() and after(ms, fn) → cancel
 * @param {(providerId: string) => Promise<object | null>} o.loadProvider
 *        resolves to { id, name, params, cost?, version?, module } or null if not installed
 * @param {(objectId: string, said: object) => void} o.onState
 *        its state (./state.js) and what is known of its render: { state, loaded (the
 *        render doc has), providerId, providerName, pinned, builtAt, builtHeads, bounds, at, notes }
 * @param {(objectId: string, bytes: Uint8Array, glbUrl: string) => Promise<void> | void} o.onGLB
 *        draw these bytes; a rejection is why they can't be shown
 * @param {boolean} [o.readOnly]  say and show; never claim, build or write
 * @param {{ hold(url: string): void, release(url: string): void } | null} [o.announce]
 *        told which docs it shows live (../stage/announce.js): a live object's
 *        source and render, and what its build reads; none for a fixed one
 */
export function createRenderManager({ repo, time, loadProvider, onState, onGLB, readOnly = false, announce = null }) {
  const entries = new Map();
  let disposed = false;
  // who this manager is to the lock: its peer's id, and which of this page's managers
  const self = `${repo?.peerId ?? "peer"}:${++managers}`;
  let said = 0; // its messages so far: a peer goes by the latest it has heard from each

  /**
   * May it write this object's render doc? Not when the manager is read-only,
   * nor while the render doc's handle refuses writes: a version of it pinned
   * from outside (a history checkpoint) is shown as it was, never rebuilt.
   */
  const mayWrite = (entry) => !readOnly && !handleReadOnly(entry.renderHandle);

  /** Announce (or retract) a live object's docs: a fixed one keeps its own version, so isn't. */
  function announceEntry(entry) {
    entry.deps?.reannounce();
    const want = !!announce && !entry.dead && !entry.at;
    if (want === !!entry.announced) return;
    entry.announced = want;
    for (const url of [entry.sourceUrl, entry.renderUrl]) want ? announce.hold(url) : announce.release(url);
  }

  /** Say a lock message on the render's channel (and to this page's other managers). */
  function say(entry, key, phase) {
    if (!mayWrite(entry)) return;
    const msg = { type: CLAIM_MSG, from: self, n: ++said, key, phase };
    try {
      entry.renderHandle.broadcast?.(msg);
    } catch {
      // the channel is best effort; a lost message is a peer that seems to vanish
    }
    entry.bus?.deliver(msg);
  }

  /** Evaluate again at `at` (the earliest asked for wins until it fires). */
  function wakeAt(entry, at) {
    if (!Number.isFinite(at) || at <= time.now() || entry.dead || disposed) return;
    if (entry.wake && entry.wake.at <= at) return;
    entry.wake?.cancel();
    const w = { at, cancel: null };
    w.cancel = time.after(Math.max(0, at - time.now()), () => {
      if (entry.wake === w) entry.wake = null;
      evaluate(entry);
    });
    entry.wake = w;
  }

  /**
   * The source as build() reads it: the live handle, or for a fixed object a
   * read-only view at `at.heads` (null until this replica has those heads).
   */
  function sourceView(entry) {
    const live = entry.sourceHandle;
    if (!live || !entry.at) return live ?? null;
    const c = entry.viewCache;
    if (c && c.live === live && c.key === entry.atKey) return c.view;
    const view = viewAt(live, entry.at.heads);
    if (view) entry.viewCache = { live, key: entry.atKey, view };
    return view;
  }

  /**
   * Ask the provider which other docs build() reads, and watch exactly those.
   * Only when the source (or the provider) has changed since the last ask.
   */
  function refreshDeps(entry, src) {
    const heads = sortedHeads(src.heads?.() ?? []).join(",");
    if (entry.depsAsked && entry.depsAsked.provider === entry.provider && entry.depsAsked.heads === heads) return;
    entry.depsAsked = { provider: entry.provider, heads };
    entry.deps.set(dependenciesOf(entry.provider.module, src.doc(), entry.sourceUrl));
  }

  /** What build() would read now, for staleness: { heads, fingerprint, deps, providerVersion }. */
  function sourceInfo(entry, src) {
    return { heads: src.heads?.() ?? [], fingerprint: fingerprintOf(entry.provider?.module, src.doc()), deps: entry.deps.snapshot(), providerVersion: entry.provider?.version };
  }

  /**
   * Built from changes to its source (or a dependency it records by heads)
   * that this replica hasn't synced: a peer that is ahead built it. Not for a
   * fixed object, which waits for its heads anyway.
   */
  function isBehind(entry, render) {
    if (entry.at) return false;
    const built = render.builtFrom;
    if (!knowsHeads(entry.sourceHandle, built?.heads)) return true;
    for (const [url, heads] of Object.entries(built?.deps ?? {})) {
      const h = entry.deps.handle(url);
      if (h && Array.isArray(heads) && !knowsHeads(h, heads)) return true;
    }
    return false;
  }

  async function loadGLB(entry, url) {
    try {
      const handle = await repo.find(url);
      if (entry.dead || entry.glbUrl !== url) return;
      const bytes = fileBytes(handle.doc());
      entry.glbRetries = 0;
      entry.glbRetryAt = null;
      try {
        await onGLB?.(entry.objectId, bytes, url);
        entry.shownError = null;
      } catch (err) {
        entry.shownError = `GLB failed to load: ${errorMessage(err)}`;
      }
    } catch (err) {
      if (entry.dead || entry.glbUrl !== url) return;
      // the file doc may not have synced yet (a peer just built it): forget it, and load it again in a while
      entry.shownError = `Could not load GLB: ${errorMessage(err)}`;
      entry.glbUrl = null;
      entry.glbRetryAt = time.now() + retryWait(entry.glbRetries++);
    }
    if (!entry.dead) evaluate(entry);
  }

  /**
   * A failure of the current inputs: this replica's own build's, or one the
   * render doc says happened (its status turned to "error") while it wasn't
   * building, which counts as the first failure of the inputs it has now.
   */
  function noteFailure(entry, render, key) {
    const status = render.status ?? "idle";
    const turned = status === "error" && entry.seenStatus !== "error";
    entry.seenStatus = status;
    if (turned && !entry.run && entry.failure?.key !== key) entry.failure = { key, n: 1, error: render.error ?? null, retryAt: time.now() + RETRY_BACKOFF_MS[0] };
  }

  /**
   * What is known of the entry now, and its state: `state` as it is said,
   * `want` as it would be with no build in progress (what deciding to build
   * reads), the inputs' `key` (null: not judged yet) and the stale `reason`.
   */
  function judge(entry, render, now) {
    const src = entry.provider ? sourceView(entry) : null;
    if (src) refreshDeps(entry, src);
    const source = src ? sourceInfo(entry, src) : null;
    const key = source ? inputsKey(render, source) : null;
    if (key) noteFailure(entry, render, key);
    if (entry.failure && entry.failure.key !== key) entry.failure = null;
    const urls = entry.deps.urls();
    const pendingSince = entry.deps.pendingSince();
    const peer = [...entry.heard].find(([, c]) => c.phase === "build" && live(c, now));
    const reason = source ? staleReason(render, source) : null;
    const known = {
      route: "built",
      render,
      providerMissing: entry.providerMissing,
      source: entry.provider && source,
      version: !!entry.provider && !src && !!entry.sourceHandle,
      building: entry.run ? { by: "here" } : peer ? { by: peer[0] } : null,
      shownError: entry.shownError,
      behind: !!reason && ["fingerprint", "heads", "deps"].includes(reason) && isBehind(entry, render),
      lastBuilt: entry.lastBuilt,
      deps: {
        notReady: urls.filter((u) => !entry.deps.ready(u)),
        failed: urls.filter((u) => entry.deps.failed(u)),
        loading: pendingSince != null && now < pendingSince + LISTEN_MS ? urls.filter((u) => entry.deps.loading(u)) : [],
      },
      failure: entry.failure ? { error: render.error ?? entry.failure.error, retryAt: entry.failure.n <= RETRY_BACKOFF_MS.length ? entry.failure.retryAt : null } : null,
    };
    if (pendingSince != null) wakeAt(entry, pendingSince + LISTEN_MS);
    return { state: contentState(known), want: contentState({ ...known, building: null }), key, reason, source };
  }

  function emit(entry, render, state) {
    const said = Object.freeze({
      state,
      loaded: !!render,
      providerId: render?.providerId ?? null,
      providerName: entry.provider?.name ?? render?.providerId ?? null,
      pinned: !!render?.pinned,
      builtAt: render?.builtAt ?? null,
      builtHeads: sortedHeads(render?.builtFrom?.heads),
      bounds: validBounds(render?.bounds),
      at: entry.at,
      notes: entry.notes ?? null,
    });
    const k = JSON.stringify(said);
    if (k === entry.saidKey) return;
    entry.saidKey = k;
    entry.said = said;
    if (!disposed && entries.get(entry.objectId) === entry) onState?.(entry.objectId, said);
  }

  function evaluate(entry) {
    if (disposed || entry.dead) return;
    const render = entry.renderHandle?.doc();
    const now = time.now();
    if (!render || !entry.sourceHandle) return emit(entry, render, contentState({ route: "built", render: null, shownError: entry.shownError }));
    if (render.glbUrl && render.glbUrl !== entry.glbUrl && !(entry.glbRetryAt > now)) {
      entry.glbUrl = render.glbUrl;
      loadGLB(entry, render.glbUrl);
    }
    if (entry.glbRetryAt != null) wakeAt(entry, entry.glbRetryAt);
    const { state, want, key, reason, source } = judge(entry, render, now);
    emit(entry, render, state);
    // what changes with time alone: a peer's claim lapsing
    for (const [, c] of entry.heard) wakeAt(entry, c.at + LAPSE_MS);
    if (!mayWrite(entry) || !key) return;
    if (entry.run) {
      if (now >= entry.run.said + HEARTBEAT_MS) {
        entry.run.said = now;
        say(entry, entry.run.key, "build");
      }
      wakeAt(entry, entry.run.said + HEARTBEAT_MS);
      // newer inputs this build won't be wanted for: it is cancelled (build() is told by its signal), and the next one starts once it has stopped
      // (a dependency still loading when it started, loaded since, isn't newer: build() reads it as it loads)
      if (entry.wantKey !== key) noteWant(entry, render, key, reason, now);
      if (!entry.run.forced && looseKey(render, source, entry.run.pending) !== entry.run.loose && wantsBuild(want) && now >= entry.wantedAt + entry.wantDelay) entry.run.controller.abort();
      return;
    }
    if (entry.forceNext) return void build(entry, key, true);
    if (key !== entry.wantKey) noteWant(entry, render, key, reason, now);
    const retrying = want.state === "failed" && want.in === "build" && want.retryAt != null;
    if (!wantsBuild(want) && !retrying) {
      if (entry.mine) entry.mine = null;
      if (entry.failure?.retryAt != null) wakeAt(entry, entry.failure.retryAt);
      return;
    }
    if (retrying && now < want.retryAt) return void wakeAt(entry, want.retryAt);
    if (now < entry.wantedAt + entry.wantDelay) return void wakeAt(entry, entry.wantedAt + entry.wantDelay);
    const step = lockStep({ now, self, key, mine: entry.mine, heard: entry.heard, listenedFrom: entry.listenedFrom, alone: entry.alone });
    if (step.act === "claim") {
      entry.mine = { key, at: now };
      say(entry, key, "claim");
      return void evaluate(entry);
    }
    if (step.act === "build") return void build(entry, key, false);
    if (step.yielded) entry.mine = null;
    wakeAt(entry, step.until);
  }

  /** The inputs moved to `key`: a build of them waits out its debounce from now (staleness.js debounceFor). */
  function noteWant(entry, render, key, reason, now) {
    entry.wantKey = key;
    entry.wantedAt = now;
    entry.wantDelay = debounceFor(reason, { specs: entry.provider.params ?? [], providerCost: entry.provider.cost, changed: reason === "params" ? changedKeys(parseKey(render.builtFrom?.paramsKey), render.params ?? {}) : [] });
    if (entry.wantDelay > 0) wakeAt(entry, now + entry.wantDelay);
  }

  async function build(entry, key, forced) {
    const render = entry.renderHandle.doc();
    const sourceHandle = sourceView(entry);
    entry.forceNext = false;
    entry.mine = null;
    if (!sourceHandle) return evaluate(entry); // fixed at heads not here yet
    refreshDeps(entry, sourceHandle);
    const source = sourceInfo(entry, sourceHandle); // dependency heads as read for this build
    console.info(`[scene] building ${render.title ?? entry.objectId} (${forced ? "asked" : (staleReason(render, source) ?? "fresh")})`);
    const controller = new AbortController();
    const pending = new Set(Object.keys(source.deps).filter((u) => !source.deps[u].length));
    entry.run = { key, forced, controller, said: time.now(), pending, loose: looseKey(render, source, pending) };
    entry.alone = false;
    say(entry, key, "build");
    evaluate(entry); // (says "building", and sets the heartbeat)
    const result = await runBuild({
      // a fixed object reads its listed dependencies at their fixed heads too
      repo: entry.at ? pinnedRepo(repo, entry.at.deps) : repo,
      renderHandle: entry.renderHandle,
      sourceHandle,
      provider: entry.provider,
      deps: source.deps,
      // a dependency still loading when the build started that loaded during it: the provider's own find() read it as it loaded
      depsAfter: (before) => {
        const out = { ...before };
        for (const u of Object.keys(out)) {
          if (out[u].length) continue;
          const h = entry.deps.headsAtLoad(u);
          if (h) out[u] = h;
        }
        return out;
      },
      signal: controller.signal,
      now: time.now,
    });
    entry.run = null;
    say(entry, key, "done");
    if (entry.dead || disposed) return;
    if (result.ok) {
      entry.lastBuilt = builtInputsKey(result.builtFrom);
      entry.failure = null;
      entry.notes = result.meta?.notes ?? null;
    } else if (!result.aborted) {
      const n = entry.failure?.key === key ? entry.failure.n + 1 : 1;
      entry.failure = { key, n, error: result.error, retryAt: n <= RETRY_BACKOFF_MS.length ? time.now() + RETRY_BACKOFF_MS[n - 1] : null };
    }
    entry.seenStatus = entry.renderHandle.doc()?.status ?? "idle";
    evaluate(entry);
  }

  /**
   * @param {string} objectId
   * @param {object} o
   * @param {string} o.sourceUrl
   * @param {string} o.renderUrl
   * @param {boolean} [o.createdHere]  this stage made the render doc: nobody else knows of it yet
   * @param {{ heads: string[], deps?: { [url]: string[] } } | null} [o.at]
   *        the scene object's fixed version; absent/null = follow the latest
   */
  async function track(objectId, { sourceUrl, renderUrl, createdHere = false, at = null }) {
    const existing = entries.get(objectId);
    const fixed = normalizeAt(at);
    const fixedKey = atKey(fixed);
    if (existing && existing.sourceUrl === sourceUrl && existing.renderUrl === renderUrl) {
      if (existing.atKey === fixedKey) return;
      // Fixed, refixed or let go: same docs, read at other heads. Ask again
      // for dependencies and judge again; nothing else about the entry changes.
      existing.at = fixed;
      existing.atKey = fixedKey;
      announceEntry(existing);
      existing.viewCache = null;
      existing.depsAsked = null;
      existing.failure = null;
      evaluate(existing);
      return;
    }
    if (existing) untrack(objectId);

    const entry = {
      objectId,
      sourceUrl,
      renderUrl,
      createdHere,
      at: fixed,
      atKey: fixedKey,
      viewCache: null,
      listenedFrom: Infinity, // (since the render doc was opened)
      alone: createdHere, // made here and not built yet: nobody else knows of it
      deps: null,
      depsAsked: null,
      heard: new Map(), // peer → its latest claim { key, phase, at }
      heardN: new Map(), // peer → the latest of its messages heard (its `n`)
      mine: null, // this peer's claim { key, at }
      run: null, // the build in flight: { key, forced, controller, said }
      wake: null,
      wantKey: null,
      wantedAt: 0,
      wantDelay: 0,
      forceNext: false,
      failure: null, // { key, n, error, retryAt }
      seenStatus: null,
      lastBuilt: null,
      notes: null,
      glbUrl: null,
      glbRetries: 0,
      glbRetryAt: null,
      shownError: null,
      provider: null,
      providerMissing: false,
      said: null,
      saidKey: null,
      bus: null,
      dead: false,
      cleanups: [],
    };
    entry.deps = createDependencyWatcher({
      repo,
      time,
      announce,
      // read at snapshot time, so it follows the provider once that has loaded
      keyOf: (url, handle) => dependencyKeyOf(entry.provider?.module, url, handle.doc?.()),
      // a fixed object's listed dependencies are read at their fixed heads
      fixedHeadsOf: (url) => entry.at?.deps?.[url] ?? null,
      // a dependency loaded, failed or changed: as a source edit
      onChange: () => evaluate(entry),
    });
    entries.set(objectId, entry);
    announceEntry(entry);
    evaluate(entry);

    const onChange = () => evaluate(entry);
    try {
      const [renderHandle, sourceHandle] = await Promise.all([repo.find(renderUrl), repo.find(sourceUrl)]);
      if (entry.dead) return;
      entry.renderHandle = renderHandle;
      entry.sourceHandle = sourceHandle;
      entry.listenedFrom = createdHere ? -Infinity : time.now(); // (its maker has heard all there is)
      const hear = (payload) => {
        const m = payload?.message;
        if (m?.type !== CLAIM_MSG || typeof m.from !== "string" || m.from === self || typeof m.key !== "string" || !(m.n > (entry.heardN.get(m.from) ?? 0))) return;
        entry.heardN.set(m.from, m.n);
        if (m.phase === "done") entry.heard.delete(m.from);
        else if (m.phase === "claim" || m.phase === "build") entry.heard.set(m.from, { key: m.key, phase: m.phase, at: time.now() });
        evaluate(entry);
      };
      entry.bus = pageBus(renderHandle, hear);
      renderHandle.on("change", onChange);
      sourceHandle.on("change", onChange);
      renderHandle.on("ephemeral-message", hear);
      entry.cleanups.push(() => {
        renderHandle.off("change", onChange);
        sourceHandle.off("change", onChange);
        renderHandle.off("ephemeral-message", hear);
        entry.bus.leave();
      });
    } catch (err) {
      if (entry.dead) return;
      entry.shownError = `Could not open: ${errorMessage(err)}`;
      return evaluate(entry);
    }
    await resolveProvider(entry);
    evaluate(entry);
  }

  async function resolveProvider(entry) {
    const providerId = entry.renderHandle?.doc()?.providerId;
    if (!providerId) {
      entry.providerMissing = true;
      return;
    }
    try {
      const p = await loadProvider(providerId);
      if (entry.dead) return;
      entry.provider = p ?? null;
      entry.providerMissing = !p;
    } catch (err) {
      console.warn(`[scene] could not load provider ${providerId}`, err);
      entry.providerMissing = true;
    }
  }

  function untrack(objectId) {
    const entry = entries.get(objectId);
    if (!entry) return;
    entry.dead = true;
    announceEntry(entry);
    entry.wake?.cancel();
    entry.run?.controller.abort();
    entry.deps.dispose();
    for (const c of entry.cleanups) c();
    entries.delete(objectId);
  }

  return {
    track,
    untrack,
    /** Ids currently tracked. */
    ids: () => [...entries.keys()],
    has: (objectId) => entries.has(objectId),
    /** What it last said of an object (see onState), or null. */
    said: (objectId) => entries.get(objectId)?.said ?? null,
    /**
     * The `at` that fixes this object at exactly what its render was last
     * built from (atFromBuilt), or null if it was never built or isn't
     * tracked. A dependency recorded by key has no heads in builtFrom; while
     * its key is still the one built from, its current heads stand in.
     */
    fixPoint(objectId) {
      const entry = entries.get(objectId);
      const built = entry?.renderHandle?.doc()?.builtFrom;
      if (!built) return null;
      const snap = entry.deps.snapshot();
      const keyed = {};
      for (const [url, h] of Object.entries(built.deps ?? {})) {
        const k = Array.isArray(h) && h.length === 1 && String(h[0]).startsWith("fp:") ? String(h[0]) : null;
        if (!k || snap[url]?.[0] !== k) continue;
        const heads = entry.at?.deps?.[url] ?? entry.deps.handle(url)?.heads?.();
        if (heads?.length) keyed[url] = heads;
      }
      return atFromBuilt(built, keyed);
    },
    /** Build now, even if pinned or fresh (after the build in flight, if one is). */
    rebuild(objectId) {
      const entry = entries.get(objectId);
      if (!entry?.provider || !entry.renderHandle || !mayWrite(entry)) return;
      entry.forceNext = true;
      evaluate(entry);
    },
    /** Call when the provider registry changes: retries objects whose provider was missing. */
    async providersChanged() {
      for (const entry of entries.values()) {
        if (entry.provider || !entry.renderHandle) continue;
        await resolveProvider(entry);
        evaluate(entry);
      }
    },
    dispose() {
      for (const id of [...entries.keys()]) untrack(id);
      disposed = true;
    },
  };
}
