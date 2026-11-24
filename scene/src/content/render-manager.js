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
// claims, builds or writes. One made with `auto: false` (a render's build
// controls opened alone) builds only when asked.

import { fileBytes } from "../shared/file-content.js";
import { dependenciesOf, dependencyKeyOf, errorMessage, fingerprintOf, runBuild, validBounds } from "./build.js";
import { changedKeys } from "../shared/params.js";
import { createDependencyWatcher, retryWait } from "./deps.js";
import { handleReadOnly } from "../stage/readonly.js";
import { pageBus } from "../stage/presence.js";
import { atFromBuilt, builtInputsKey, debounceFor, inputsKey, staleReason } from "./staleness.js";
import { atKey, knowsHeads, normalizeAt, pinnedRepo, sortedHeads, viewAt } from "../shared/versions.js";
import { contentState, wantsBuild } from "./state.js";
import { HEARTBEAT_MS, LAPSE_MS, live, lockStep } from "./lock.js";

/** The lock's message on a render doc's channel: { type, from, n, phase: "claim" | "build" | "hold" | "done" } (`n` counts up from each sender). */
export const CLAIM_MSG = "scene-render:claim";
/** A failed build is tried again after each of these, its inputs unchanged; then left until they change or someone asks. */
export const RETRY_BACKOFF_MS = Object.freeze([5_000, 30_000, 120_000]);
/** A dependency on its first load is waited for this long; then the render is built without it. */
export const DEPENDENCY_WAIT_MS = 6_000;

/** A manager's id to the lock: its own, never its repo's (two tabs, two managers in one page, share one). */
const newId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);

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
 * @param {boolean} [o.auto]  build when a render wants it (else only when asked: rebuild())
 * @param {{ hold(url: string): void, release(url: string): void } | null} [o.announce]
 *        told which docs it shows live (../stage/announce.js): a live object's
 *        source and render, and what its build reads; none for a fixed one
 */
export function createRenderManager({ repo, time, loadProvider, onState, onGLB, readOnly = false, auto = true, announce = null }) {
  const entries = new Map();
  let disposed = false;
  const self = newId(); // who this manager is to the lock
  let spoken = 0; // its messages so far: a peer goes by the latest it has heard from each

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
  function say(entry, phase) {
    if (!mayWrite(entry)) return;
    entry.lastSaid = time.now();
    const msg = { type: CLAIM_MSG, from: self, n: ++spoken, phase };
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
    const built = render.result?.builtFrom;
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
   * A failure the render doc records for exactly the inputs this peer has
   * now (`key`: its params, source, dependencies and provider version), while
   * it doesn't hold the render: the holder's to retry, so here those inputs
   * are given up on until they change or someone asks. A failure of other
   * inputs (another provider version's, say) is left alone.
   */
  function noteFailure(entry, render, key) {
    const doc = render.failure;
    if (doc?.inputs === key && !entry.holding && entry.failure?.key !== key) entry.failure = { key, n: Infinity, error: doc.error ?? null, retryAt: null };
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
    const held = [...entry.heard].some(([, c]) => c.phase !== "claim" && live(c, now));
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
      contains: (url, heads) => {
        const h = entry.deps.handle(url);
        return !!h && knowsHeads(h, heads);
      },
      deps: {
        notReady: urls.filter((u) => !entry.deps.ready(u)),
        failed: urls.filter((u) => entry.deps.failed(u)),
        loading: pendingSince != null && now < pendingSince + DEPENDENCY_WAIT_MS ? urls.filter((u) => entry.deps.loading(u)) : [],
      },
      failure: null,
    };
    if (pendingSince != null) wakeAt(entry, pendingSince + DEPENDENCY_WAIT_MS);
    // what deciding to build reads: the state with no build in progress, no failure and nothing it can't show
    const want = contentState({ ...known, building: null, shownError: null });
    // (retrying: this peer will try again, or another holds the render to)
    const f = entry.failure;
    if (f) known.failure = { error: f.error, retrying: (auto && f.retryAt != null && wantsBuild(want)) || held };
    return { state: contentState(known), want, key, reason, source };
  }

  function emit(entry, render, state) {
    const said = Object.freeze({
      state,
      loaded: !!render,
      providerId: render?.providerId ?? null,
      providerName: entry.provider?.name ?? render?.providerId ?? null,
      pinned: !!render?.pinned,
      builtAt: render?.result?.builtAt ?? null,
      builtHeads: sortedHeads(render?.result?.builtFrom?.heads),
      bounds: validBounds(render?.result?.bounds),
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
    const glbUrl = render.result?.glbUrl;
    if (glbUrl && glbUrl !== entry.glbUrl && !(entry.glbRetryAt > now)) {
      entry.glbUrl = glbUrl;
      loadGLB(entry, glbUrl);
    }
    if (entry.glbRetryAt != null) wakeAt(entry, entry.glbRetryAt);
    const { state, want, key, reason, source } = judge(entry, render, now);
    emit(entry, render, state);
    // what changes with time alone: a peer's claim lapsing
    for (const [, c] of entry.heard) wakeAt(entry, c.at + LAPSE_MS);
    if (!mayWrite(entry) || !key) return;
    if (key !== entry.wantKey) noteWant(entry, render, key, reason, now);
    const f = entry.failure;
    const wanted = auto && wantsBuild(want) && (!f || f.retryAt != null);
    const debounced = now >= entry.wantedAt + entry.wantDelay;
    const due = entry.forceNext || (wanted && debounced && (!f || now >= f.retryAt));
    const waits = () => {
      if (wanted && !debounced) wakeAt(entry, entry.wantedAt + entry.wantDelay);
      if (wanted && f?.retryAt != null) wakeAt(entry, f.retryAt);
    };
    if (entry.holding) {
      // two holders after a split (a lost message): the higher id lets go once it isn't building
      const others = [...entry.heard].filter(([, c]) => c.phase !== "claim" && live(c, now));
      if (others.some(([peer]) => peer < self) && !entry.run) return release(entry);
      if (now >= entry.lastSaid + HEARTBEAT_MS) say(entry, entry.run ? "build" : "hold");
      wakeAt(entry, entry.lastSaid + HEARTBEAT_MS);
      if (entry.run) {
        // newer inputs this build won't be wanted for: it is cancelled (build() is told by its signal) and the next starts once it has stopped
        // (a dependency still loading when it started, loaded since, isn't newer: build() reads it as it loads)
        if (looseKey(render, source, entry.run.pending) !== entry.run.loose && wantsBuild(want) && debounced) entry.run.controller.abort();
        return;
      }
      // another holder still building (a frozen holder woke beside its successor): it waits for that build to end
      if (due && others.some(([, c]) => c.phase === "build")) return void waits();
      if (due) return void build(entry, key, entry.forceNext);
      if (wanted) return void (waits(), (entry.idleSince = null));
      // it has wanted nothing for HEARTBEAT_MS: let the render go
      entry.idleSince ??= now;
      if (now < entry.idleSince + HEARTBEAT_MS) return void wakeAt(entry, entry.idleSince + HEARTBEAT_MS);
      return release(entry);
    }
    if (!due) {
      if (entry.mine) (entry.mine = null), say(entry, "done");
      return waits();
    }
    const step = lockStep({ now, self, mine: entry.mine, heard: entry.heard, alone: entry.alone });
    if (step.act === "claim") {
      entry.mine = { at: now };
      say(entry, "claim");
      return void evaluate(entry);
    }
    if (step.act === "hold") {
      entry.mine = null;
      entry.holding = true;
      entry.idleSince = null;
      say(entry, "hold");
      return void build(entry, key, entry.forceNext);
    }
    if (step.yielded) (entry.mine = null), say(entry, "done");
    wakeAt(entry, step.until);
  }

  /** Let the render go: say so, and hold nothing. */
  function release(entry) {
    entry.holding = false;
    entry.idleSince = null;
    say(entry, "done");
  }

  /** The inputs moved to `key`: a build of them waits out its debounce from now (staleness.js debounceFor). */
  function noteWant(entry, render, key, reason, now) {
    entry.wantKey = key;
    entry.wantedAt = now;
    entry.wantDelay = debounceFor(reason, { specs: entry.provider.params ?? [], providerCost: entry.provider.cost, changed: reason === "params" ? changedKeys(parseKey(render.result?.builtFrom?.paramsKey), render.params ?? {}) : [] });
    if (entry.wantDelay > 0) wakeAt(entry, now + entry.wantDelay);
  }

  async function build(entry, key, forced) {
    const render = entry.renderHandle.doc();
    const sourceHandle = sourceView(entry);
    entry.forceNext = false;
    if (!sourceHandle) return evaluate(entry); // fixed at heads not here yet
    refreshDeps(entry, sourceHandle);
    const source = sourceInfo(entry, sourceHandle); // dependency heads as read for this build
    console.info(`[scene] building ${render.title ?? entry.objectId} (${forced ? "asked" : (staleReason(render, source) ?? "fresh")})`);
    const controller = new AbortController();
    const pending = new Set(Object.keys(source.deps).filter((u) => !source.deps[u].length));
    const run = { key, controller, startedAt: time.now(), pending, loose: looseKey(render, source, pending) };
    entry.run = run;
    entry.alone = false;
    say(entry, "build");
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
      inputs: key, // (a failure is recorded against them: noteFailure)
    });
    entry.run = null;
    if (entry.dead || disposed) return;
    if (entry.holding) say(entry, "hold"); // (no longer building: what readers show changes at once)
    if (result.ok) {
      entry.lastBuilt = builtInputsKey(result.builtFrom);
      entry.failure = null;
      entry.notes = result.meta?.notes ?? null;
    } else if (!result.aborted && !result.fenced) {
      const n = entry.failure?.key === key ? entry.failure.n + 1 : 1;
      entry.failure = { key, n, error: result.error, retryAt: n <= RETRY_BACKOFF_MS.length ? time.now() + RETRY_BACKOFF_MS[n - 1] : null };
    }
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
      alone: createdHere, // made here and not built yet: nobody else knows of it
      deps: null,
      depsAsked: null,
      heard: new Map(), // peer → its latest claim { phase, at }
      heardN: new Map(), // peer → the latest of its messages heard (its `n`)
      mine: null, // this peer's claim { at }, while it waits for a rival
      holding: false, // this peer holds the render
      idleSince: null, // holding, it has wanted nothing since
      lastSaid: -Infinity, // when it last spoke on the render's channel
      run: null, // the build in flight: { key, controller, startedAt, pending, loose }
      wake: null,
      wantKey: null,
      wantedAt: 0,
      wantDelay: 0,
      forceNext: false,
      failure: null, // { key, n, error, retryAt }
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
      const hear = (payload) => {
        const m = payload?.message;
        if (m?.type !== CLAIM_MSG || typeof m.from !== "string" || m.from === self || !(m.n > (entry.heardN.get(m.from) ?? 0))) return;
        entry.heardN.set(m.from, m.n);
        if (m.phase === "done") entry.heard.delete(m.from);
        else if (m.phase === "claim" || m.phase === "build" || m.phase === "hold") {
          entry.heard.set(m.from, { phase: m.phase, at: time.now() });
          // a claim this peer beats is answered at once, so the claimer hears it within its window
          if (m.phase === "claim" && entry.holding) say(entry, entry.run ? "build" : "hold");
          else if (m.phase === "claim" && entry.mine && self < m.from) say(entry, "claim");
        }
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
    if (entry.holding || entry.mine) say(entry, "done");
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
      const built = entry?.renderHandle?.doc()?.result?.builtFrom;
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
