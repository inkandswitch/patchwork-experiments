// Keeps every object in a scene built: watches each object's source doc and
// render doc, decides when a render is stale, debounces, builds, and hands the
// current GLB bytes to the view. No three.js here, so it is testable with fakes.
//
// An object fixed at a version (scene object `at`) is built from a read-only
// view of its source at those heads, and from views of the dependencies `at`
// lists; staleness is judged against those views, so edits to the live docs
// never make it stale. Params and provider versions still do.

import { fileBytes } from "./file-content.js";
import { dependenciesOf, dependencyKeyOf, errorMessage, fingerprintOf, knowsHeads, pinnedRepo, runBuild, validBounds, viewAt } from "./build.js";
import { createDependencyWatcher } from "./deps.js";
import { atFromBuilt, atKey, builtInputsKey, changedKeys, debounceFor, heldDeps, inputsKey, isContested, normalizeAt, sortedHeads, staleReason } from "./staleness.js";

// How long to hold off building inputs a peer says (or the doc says) it is building.
export const REMOTE_BUILD_GRACE_MS = 20_000;
// A "building" status nobody here is running, older than this, is left over from a
// client that went away mid-build; it is reset so the render doesn't look busy forever.
export const STUCK_BUILDING_MS = 60_000;
const GLB_RETRY_MS = 1_000;
const GLB_RETRY_MAX_MS = 30_000;
const BUILDING_MSG = "scene-render:building";
// Two open scenes that get the same edit start the same (fast) build within one
// relay round trip, before either hears the other's announcement. Once a scene has
// heard another builder whose peer id sorts lower than its own, it waits this much
// longer on automatic rebuilds, so that peer's announcement or result lands first.
// Learned per session from the announcements themselves; nothing goes in the doc.
export const PEER_STAGGER_MS = 1_000;
const PEER_MEMORY_MS = 30 * 60_000;
// A render whose dependencies are still loading for the first time holds off
// building this long (so opening a scene doesn't build once without them and
// again with them). After that it builds anyway; build() decides what a
// missing dependency means. This does not apply to a dependency the render
// was already built from (recorded with heads): that is never rebuilt over
// until this client can read it (see heldDeps).
export const DEP_WAIT_MS = 5_000;
// A build that throws is retried automatically after each of these waits (its
// inputs unchanged), then left alone until they change or someone presses
// Rebuild. Covers the transient failures inside build(): a CDN fetch, a worker
// that ran out of memory once, a dependency that answered late.
export const RETRY_BACKOFF_MS = Object.freeze([5_000, 30_000, 120_000]);
// A render doc this client didn't just create may be handed over before its
// history has synced: a fresh peer can see the seed (builtFrom: null) for a
// moment and would rebuild something that is already built (seen in Patchwork:
// every new viewer rebuilt "never-built" renders at once). So no automatic
// build starts sooner than this after the render doc was opened. Every change
// re-evaluates, so when the real builtFrom arrives the build is called off.
export const SYNC_SETTLE_MS = 2_500;

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
 * @param {(providerId: string) => Promise<object | null>} o.loadProvider
 *        resolves to { id, name, params, cost?, version?, module } or null if not installed
 * @param {(objectId: string, state: object) => void} o.onState
 * @param {(objectId: string, bytes: Uint8Array, glbUrl: string) => void} o.onGLB
 * @param {{ setTimeout, clearTimeout }} [o.timers]
 * @param {() => number} [o.now]
 * @param {number} [o.syncSettleMs]  see SYNC_SETTLE_MS
 */
export function createRenderManager({ repo, loadProvider, onState, onGLB, timers = globalThis, now = Date.now, syncSettleMs = SYNC_SETTLE_MS }) {
  const entries = new Map();
  let disposed = false;
  const selfId = repo?.peerId ?? null;
  const knownBuilders = new Map(); // peer id → last announcement time

  function peerStagger() {
    if (!selfId) return 0;
    const t = now();
    let stagger = 0;
    for (const [id, at] of knownBuilders) {
      if (t - at > PEER_MEMORY_MS) knownBuilders.delete(id);
      else if (String(id) < String(selfId)) stagger = PEER_STAGGER_MS;
    }
    return stagger;
  }

  function emit(entry, patch = {}) {
    Object.assign(entry.state, patch);
    if (!disposed && entries.get(entry.objectId) === entry) onState?.(entry.objectId, { ...entry.state });
  }

  function clearTimer(entry, which = "timer") {
    if (entry[which] != null) timers.clearTimeout(entry[which]);
    entry[which] = null;
  }

  function reevaluateIn(entry, which, ms) {
    clearTimer(entry, which);
    entry[which] = timers.setTimeout(() => {
      entry[which] = null;
      evaluate(entry);
    }, Math.max(0, ms));
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
  function refreshDeps(entry) {
    const src = sourceView(entry);
    if (!entry.provider || !src) return;
    const heads = sortedHeads(src.heads?.() ?? []).join(",");
    if (entry.depsAsked && entry.depsAsked.provider === entry.provider && entry.depsAsked.heads === heads) return;
    entry.depsAsked = { provider: entry.provider, heads };
    entry.deps.set(dependenciesOf(entry.provider.module, src.doc(), entry.sourceUrl));
  }

  function sourceInfo(entry) {
    const src = sourceView(entry);
    const doc = src?.doc();
    return {
      doc,
      heads: src?.heads?.() ?? [],
      fingerprint: fingerprintOf(entry.provider?.module, doc),
      deps: entry.deps.snapshot(),
      providerVersion: entry.provider?.version,
    };
  }

  async function loadGLB(entry, url) {
    try {
      const handle = await repo.find(url);
      if (entry.dead || entry.glbUrl !== url) return;
      const bytes = fileBytes(handle.doc());
      if (entry.dead || entry.glbUrl !== url) return;
      entry.glbRetries = 0;
      emit(entry, { glbError: null });
      onGLB?.(entry.objectId, bytes, url);
    } catch (err) {
      if (entry.dead || entry.glbUrl !== url) return;
      emit(entry, { glbError: `Could not load GLB: ${errorMessage(err)}` });
      // The file doc may simply not have synced yet (a peer just built it).
      // Forget it so the next evaluate loads it again, and make sure there is one.
      entry.glbUrl = null;
      reevaluateIn(entry, "glbTimer", Math.min(GLB_RETRY_MAX_MS, GLB_RETRY_MS * 2 ** entry.glbRetries++));
    }
  }

  /**
   * Stale reason; whether the staleness is a war with a peer we must not
   * auto-fight (isContested); and which recorded dependencies we can't read
   * here, so must not auto-rebuild over (heldDeps).
   */
  function judge(entry, render, source) {
    const reason = staleReason(render, source);
    const contested = isContested(render, source, entry.lastBuilt);
    const held = reason === "deps" ? heldDeps(render.builtFrom?.deps, source.deps, (u) => entry.deps.ready(u)) : [];
    return { reason, contested, held, behind: isBehind(entry, render, reason) };
  }

  /**
   * The render was built from changes to its source (or a dependency it records
   * by heads) that this client hasn't synced yet: a peer that is ahead built
   * it. It only *looks* stale here; rebuilding would replace a newer build with
   * one made from an older version, and that peer would rebuild straight back
   * (seen in Patchwork: a client missing one edit to a flow doc and a client
   * with it took turns rebuilding the flow, every time either opened the scene).
   * Never auto-rebuilt; a change to the source or the dependency re-evaluates.
   * Not for objects fixed at a version (`at`), which wait for their heads anyway.
   */
  function isBehind(entry, render, reason) {
    if (reason !== "fingerprint" && reason !== "heads" && reason !== "deps") return false;
    if (entry.at) return false;
    const built = render.builtFrom;
    if (!knowsHeads(entry.sourceHandle, built?.heads)) return true;
    for (const [url, heads] of Object.entries(built?.deps ?? {})) {
      const h = entry.deps.handle(url);
      if (h && Array.isArray(heads) && !knowsHeads(h, heads)) return true;
    }
    return false;
  }

  function settleStatus(entry) {
    entry.renderHandle.change((d) => {
      d.status = "idle";
      d.error = null;
    });
  }

  function evaluate(entry) {
    if (disposed || entry.dead || !entry.renderHandle) return;
    const render = entry.renderHandle.doc();
    if (!render) return;

    if (render.glbUrl && render.glbUrl !== entry.glbUrl) {
      entry.glbUrl = render.glbUrl;
      loadGLB(entry, render.glbUrl);
    }

    // A "building" status that isn't ours: note when we first saw it.
    const othersBuilding = render.status === "building" && !entry.building;
    if (!othersBuilding) {
      entry.buildingSeenAt = null;
      entry.statusHint = null;
      clearTimer(entry, "statusTimer");
    } else if (entry.buildingSeenAt == null) {
      entry.buildingSeenAt = now();
    }

    const base = {
      status: render.status ?? "idle",
      error: render.error ?? null,
      pinned: !!render.pinned,
      builtAt: render.builtAt ?? null,
      hasGLB: !!render.glbUrl,
      building: entry.building,
      providerId: render.providerId,
      providerName: entry.provider?.name ?? render.providerId,
      bounds: validBounds(render.bounds),
      retryAt: entry.retryTimer != null ? entry.retryAt : null,
      fixed: !!entry.at,
      at: entry.at,
      builtHeads: sortedHeads(render.builtFrom?.heads),
    };

    if (!entry.sourceHandle) return emit(entry, { ...base, phase: "loading" });
    if (!entry.provider) {
      return emit(entry, {
        ...base,
        phase: entry.providerMissing ? "no-provider" : "loading",
        stale: false,
        reason: null,
      });
    }

    // Fixed at heads this replica doesn't have yet: the source's "change"
    // brings them, and evaluates again.
    if (!sourceView(entry)) return emit(entry, { ...base, phase: "loading", versionMissing: true, stale: false, reason: null });

    refreshDeps(entry);
    const source = sourceInfo(entry);
    const { reason, contested, held, behind } = judge(entry, render, source);
    const key = inputsKey(render, source);
    const depsPendingSince = entry.deps.pendingSince();
    // Built from a dependency that we tried and failed to load here.
    const depsUnavailable = held.filter((u) => entry.deps.failed(u));
    // Only the dependencies look different, and they haven't loaded yet: we can't tell.
    const unsure = reason === "deps" && depsPendingSince != null && !depsUnavailable.length;
    emit(entry, {
      ...base,
      phase: "ready",
      versionMissing: false,
      stale: !!reason && !unsure && !behind,
      reason: unsure || behind ? null : reason,
      behind,
      contested,
      // built by a scene host from before dependencies (SCENE-CONTRACT v2 §1)
      // existed: it records no `deps` at all, where this one always does
      olderHost: contested && !!render.builtFrom && render.builtFrom.deps === undefined,
      depsUnavailable,
      deps: entry.deps.urls(),
    });

    if (entry.building) return; // build() re-evaluates when it finishes

    if (othersBuilding) {
      if (now() - entry.buildingSeenAt >= STUCK_BUILDING_MS) return settleStatus(entry); // re-enters via "change"
      // Whoever wrote it may have announced it before we were listening (a
      // freshly added object): treat the status as that announcement.
      if (!entry.statusHint) entry.statusHint = { key, until: entry.buildingSeenAt + REMOTE_BUILD_GRACE_MS };
      reevaluateIn(entry, "statusTimer", entry.buildingSeenAt + STUCK_BUILDING_MS - now());
    }

    if (!reason) {
      clearTimer(entry);
      clearTimer(entry, "retryTimer");
      entry.failedKey = null;
      entry.failureKey = null;
      entry.failures = 0;
      // Up to date, but the doc still says a (superseded) build failed: e.g. an
      // edit broke the build and a later edit put the source back.
      if (render.status === "error" || (render.status === "idle" && render.error != null)) settleStatus(entry);
      return;
    }
    if (contested && !entry.forceNext) {
      // Same source and params as our own last build; only a peer's differing
      // fingerprint says otherwise. Rebuilding would just flip it back. Manual only.
      clearTimer(entry);
      return;
    }
    if (behind && !entry.forceNext) {
      // A peer built it from changes we don't have yet: wait for them to sync.
      clearTimer(entry);
      return;
    }
    if (held.length && !entry.forceNext) {
      // Built from a dependency we can't read (yet). Rebuilding now would drop
      // it, and whoever can read it would rebuild straight back. Re-enters when
      // the watcher loads it; until then, manual only.
      clearTimer(entry);
      clearTimer(entry, "depTimer");
      return;
    }
    if (render.pinned && !entry.forceNext) {
      clearTimer(entry);
      return;
    }
    if (key === entry.failedKey && !entry.forceNext) return; // don't hammer a failing build
    if (depsPendingSince != null && !entry.forceNext) {
      const left = depsPendingSince + DEP_WAIT_MS - now();
      if (left > 0) {
        // Re-enters when they load (the watcher calls evaluate) or when the wait is up.
        clearTimer(entry);
        reevaluateIn(entry, "depTimer", left);
        return;
      }
    }
    clearTimer(entry, "depTimer");

    let delay = debounceFor(reason, {
      specs: entry.provider.params ?? [],
      providerCost: entry.provider.cost,
      changed: reason === "params" ? changedKeys(parseKey(render.builtFrom?.paramsKey), render.params ?? {}) : [],
    });
    if (entry.forceNext) delay = 0;
    else {
      delay += peerStagger();
      if (!entry.createdHere && entry.openedAt != null) delay = Math.max(delay, entry.openedAt + syncSettleMs - now());
    }
    // Someone else said they are building exactly this; give them a chance.
    if (!entry.forceNext) {
      for (const hint of [entry.remote, entry.statusHint]) {
        if (hint && hint.key === key && hint.until > now()) delay = Math.max(delay, hint.until - now());
      }
    }
    clearTimer(entry);
    entry.timer = timers.setTimeout(() => {
      entry.timer = null;
      build(entry);
    }, delay);
  }

  async function build(entry) {
    if (disposed || entry.dead || entry.building) return;
    const render = entry.renderHandle.doc();
    const sourceHandle = sourceView(entry);
    if (!sourceHandle) return evaluate(entry); // fixed at heads not here yet
    refreshDeps(entry);
    const source = sourceInfo(entry); // dependency heads as read for this build
    const force = entry.forceNext;
    entry.forceNext = false;
    // Re-check: a peer may have finished while we waited, or the source may
    // now list a dependency that is still loading (evaluate waits for it).
    let why = "forced";
    if (!force) {
      const { reason, contested, held, behind } = judge(entry, render, source);
      if (!reason || contested || held.length || behind || render.pinned) return;
      if (!entry.createdHere && entry.openedAt != null && now() < entry.openedAt + syncSettleMs) return evaluate(entry);
      const pending = entry.deps.pendingSince();
      if (pending != null && pending + DEP_WAIT_MS > now()) return evaluate(entry);
      why = reason;
    }
    console.info(`[scene] building ${render.title ?? entry.objectId} (${why})`);
    const key = inputsKey(render, source);

    entry.building = true;
    emit(entry, { building: true });
    try {
      entry.renderHandle.broadcast?.({ type: BUILDING_MSG, key });
    } catch {
      // presence is best effort
    }
    const result = await runBuild({
      // a fixed object reads its listed dependencies at their fixed heads too
      repo: entry.at ? pinnedRepo(repo, entry.at.deps) : repo,
      renderHandle: entry.renderHandle,
      sourceHandle,
      provider: entry.provider,
      deps: source.deps,
      // A dependency that was still loading when the build started and loaded
      // during it: the provider's own find() read it as it loaded.
      depsAfter: (before) => {
        const out = { ...before };
        for (const u of Object.keys(out)) {
          if (out[u].length) continue;
          const h = entry.deps.headsAtLoad(u);
          if (h) out[u] = h;
        }
        return out;
      },
      now,
    });
    entry.building = false;
    if (entry.dead) return;
    if (result.ok) {
      entry.lastBuilt = builtInputsKey(result.builtFrom);
      entry.failedKey = null;
      entry.failureKey = null;
      entry.failures = 0;
      clearTimer(entry, "retryTimer");
    } else if (result.aborted) {
      // cancelled by the provider, not failed: evaluate again below
    } else {
      // Don't hammer a failing build, but don't give up on it at once either.
      // counted against failureKey, which (unlike failedKey) the retry timer leaves alone
      entry.failures = entry.failureKey === key ? entry.failures + 1 : 1;
      entry.failureKey = key;
      entry.failedKey = key;
      clearTimer(entry, "retryTimer");
      const wait = RETRY_BACKOFF_MS[entry.failures - 1];
      if (wait != null) {
        entry.retryAt = now() + wait;
        entry.retryTimer = timers.setTimeout(() => {
          entry.retryTimer = null;
          if (entry.failedKey === key) entry.failedKey = null; // the next evaluate may build it again
          evaluate(entry);
        }, wait);
      }
    }
    emit(entry, { building: false, notes: result.ok ? result.meta?.notes ?? null : entry.state.notes ?? null });
    if (entry.forceNext) {
      // A rebuild was asked for while this one ran; it still has to happen.
      clearTimer(entry);
      return build(entry);
    }
    evaluate(entry);
  }

  /**
   * @param {string} objectId
   * @param {object} o
   * @param {string} o.sourceUrl
   * @param {string} o.renderUrl
   * @param {boolean} [o.createdHere]
   * @param {{ heads: string[], deps?: { [url]: string[] } } | null} [o.at]
   *        the scene object's fixed version; absent/null = follow the latest
   */
  async function track(objectId, { sourceUrl, renderUrl, createdHere = false, at = null }) {
    const existing = entries.get(objectId);
    const fixed = normalizeAt(at);
    const fixedKey = atKey(fixed);
    if (existing && existing.sourceUrl === sourceUrl && existing.renderUrl === renderUrl) {
      if (existing.atKey === fixedKey) return;
      // Fixed, refixed or let go: same docs, read at other heads. Re-ask for
      // dependencies and judge again; nothing else about the entry changes.
      existing.at = fixed;
      existing.atKey = fixedKey;
      existing.viewCache = null;
      existing.depsAsked = null;
      existing.failedKey = null;
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
      openedAt: null,
      state: { phase: "loading", stale: false, building: false },
      timer: null,
      statusTimer: null,
      glbTimer: null,
      depTimer: null,
      deps: null,
      depsAsked: null,
      building: false,
      failedKey: null,
      failures: 0,
      failureKey: null,
      retryTimer: null,
      retryAt: null,
      forceNext: false,
      lastBuilt: null,
      buildingSeenAt: null,
      statusHint: null,
      glbUrl: null,
      glbRetries: 0,
      provider: null,
      providerMissing: false,
      remote: null,
      dead: false,
      cleanups: [],
    };
    entry.deps = createDependencyWatcher({
      repo,
      timers,
      now,
      // read at snapshot time, so it follows the provider once that has loaded
      keyOf: (url, handle) => dependencyKeyOf(entry.provider?.module, url, handle.doc?.()),
      // a fixed object's listed dependencies are read at their fixed heads
      fixedHeadsOf: (url) => entry.at?.deps?.[url] ?? null,
      // a dependency loaded, failed or changed: same as a source edit
      onChange: () => {
        if (!entry.building) evaluate(entry);
      },
    });
    entries.set(objectId, entry);
    emit(entry);

    const onChange = () => evaluate(entry);
    try {
      const [renderHandle, sourceHandle] = await Promise.all([repo.find(renderUrl), repo.find(sourceUrl)]);
      if (entry.dead) return;
      entry.renderHandle = renderHandle;
      entry.sourceHandle = sourceHandle;
      entry.openedAt = now();
      renderHandle.on("change", onChange);
      sourceHandle.on("change", onChange);
      const onMsg = (payload) => {
        const msg = payload?.message;
        if (msg?.type === BUILDING_MSG && typeof msg.key === "string") {
          entry.remote = { key: msg.key, until: now() + REMOTE_BUILD_GRACE_MS };
          if (payload.senderId != null && payload.senderId !== selfId) knownBuilders.set(payload.senderId, now());
          // Reschedule: a build already waiting on its debounce should now defer to theirs.
          if (!entry.building) evaluate(entry);
        }
      };
      renderHandle.on("ephemeral-message", onMsg);
      entry.cleanups.push(() => {
        renderHandle.off("change", onChange);
        sourceHandle.off("change", onChange);
        renderHandle.off("ephemeral-message", onMsg);
      });
    } catch (err) {
      if (!entry.dead) emit(entry, { phase: "error", error: `Could not open: ${errorMessage(err)}` });
      return;
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
    clearTimer(entry);
    clearTimer(entry, "statusTimer");
    clearTimer(entry, "glbTimer");
    clearTimer(entry, "depTimer");
    clearTimer(entry, "retryTimer");
    entry.deps.dispose();
    for (const c of entry.cleanups) c();
    entries.delete(objectId);
  }

  return {
    track,
    untrack,
    /** Ids currently tracked. */
    ids: () => [...entries.keys()],
    state: (objectId) => (entries.get(objectId) ? { ...entries.get(objectId).state } : null),
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
    /** Build now, even if pinned or fresh. */
    rebuild(objectId) {
      const entry = entries.get(objectId);
      if (!entry?.provider || !entry.renderHandle) return;
      clearTimer(entry);
      entry.forceNext = true;
      if (entry.building) return; // build() runs it as soon as the current one finishes
      build(entry);
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
      disposed = true;
      for (const id of [...entries.keys()]) untrack(id);
    },
  };
}
