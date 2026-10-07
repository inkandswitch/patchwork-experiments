// One priority queue for showing GLB file docs directly (passthrough objects,
// SCENE-CONTRACT v3 §6). Pure: no three, no DOM; `find`, `read` and `parse`
// are injected, so it is testable with fakes.
//
// Per object: queued → finding → parse-queued → parsing → ready | error.
// - At most `maxFinds` repo.find calls in flight, at most `maxParses` parses at
//   a time, and the main thread is yielded to between parses.
// - Highest priority first (the caller decides: selected, then big things).
// - A failed find/read is retried with backoff (1 s doubling, capped at 30 s),
//   the same policy as the render manager's GLB loads. A parse that throws is
//   not retried until the doc changes (the bytes won't get better).
// - The source doc is subscribed to only once it has been found (while it is
//   loaded), and re-parsed when it changes. Nothing is fetched for an object
//   nobody ensure()d — the caller only ensures what is effectively visible.

export const QUEUE_LIMITS = Object.freeze({ maxFinds: 4, maxParses: 1, retryMs: 1_000, retryMaxMs: 30_000 });

const LOADING = new Set(["queued", "finding", "parse-queued", "parsing"]);
export const isLoadingPhase = (phase) => LOADING.has(phase);

const message = (err) => String(err?.message ?? err ?? "unknown error");

/**
 * @param {object} o
 * @param {(url: string) => Promise<object>} o.find          repo.find
 * @param {(handle: object) => Uint8Array} o.read            the GLB bytes of a found doc (throws if it has none)
 * @param {(id: string, bytes: Uint8Array, url: string) => Promise<void>} o.parse
 * @param {(id: string, state: { phase: string, error: string | null, url: string }) => void} [o.onState]
 * @param {() => Promise<void>} [o.yieldToMain]
 * @param {{ setTimeout, clearTimeout }} [o.timers]
 */
export function createGLBQueue({
  find,
  read,
  parse,
  onState,
  yieldToMain = () => new Promise((r) => setTimeout(r, 0)),
  timers = globalThis,
  maxFinds = QUEUE_LIMITS.maxFinds,
  maxParses = QUEUE_LIMITS.maxParses,
  retryMs = QUEUE_LIMITS.retryMs,
  retryMaxMs = QUEUE_LIMITS.retryMaxMs,
}) {
  const entries = new Map();
  let finding = 0;
  let parsing = 0;
  let disposed = false;
  let pumping = false;
  const stats = { finds: 0, parses: 0, maxFindsInFlight: 0, maxParsesInFlight: 0, errors: 0 };

  function emit(e, patch = {}) {
    Object.assign(e, patch);
    if (!disposed && entries.get(e.id) === e) onState?.(e.id, { phase: e.phase, error: e.error, url: e.url });
  }

  // ensure() calls made together (one scene sync) are all queued before any
  // starts, so the first slots go to the highest priorities, not the first ids
  let pumpQueued = false;
  function schedulePump() {
    if (pumpQueued) return;
    pumpQueued = true;
    queueMicrotask(() => {
      pumpQueued = false;
      pump();
    });
  }

  function best(phase) {
    let top = null;
    for (const e of entries.values()) if (e.phase === phase && (!top || e.priority > top.priority)) top = e;
    return top;
  }

  function pump() {
    if (disposed || pumping) return;
    pumping = true;
    try {
      while (finding < maxFinds) {
        const e = best("queued");
        if (!e) break;
        startFind(e);
      }
      while (parsing < maxParses) {
        const e = best("parse-queued");
        if (!e) break;
        startParse(e);
      }
    } finally {
      pumping = false;
    }
  }

  function retry(e, err) {
    stats.errors++;
    const wait = Math.min(retryMaxMs, retryMs * 2 ** e.retries++);
    emit(e, { phase: "error", error: message(err) });
    e.retryTimer = timers.setTimeout(() => {
      e.retryTimer = null;
      if (e.dead) return;
      emit(e, { phase: "queued" });
      pump();
    }, wait);
  }

  async function startFind(e) {
    const gen = e.gen;
    finding++;
    stats.finds++;
    stats.maxFindsInFlight = Math.max(stats.maxFindsInFlight, finding);
    emit(e, { phase: "finding", error: null });
    let handle;
    let bytes;
    try {
      handle = await find(e.url);
      if (e.dead || e.gen !== gen) return;
      bytes = read(handle);
    } catch (err) {
      if (!e.dead && e.gen === gen) retry(e, err);
      return;
    } finally {
      finding--;
      // a slot is free either way; the rest of this function runs synchronously first
      queueMicrotask(pump);
    }
    e.handle = handle;
    subscribe(e, handle);
    e.bytes = bytes;
    emit(e, { phase: "parse-queued" });
  }

  function subscribe(e, handle) {
    if (e.unsubscribe || typeof handle?.on !== "function") return;
    const onChange = () => {
      if (e.dead) return;
      let next;
      try {
        next = read(handle);
      } catch (err) {
        return emit(e, { phase: "error", error: message(err) });
      }
      if (next === e.parsedBytes) return;
      if (e.phase === "parsing") {
        e.dirty = true;
        return;
      }
      e.bytes = next;
      emit(e, { phase: "parse-queued", error: null });
      pump();
    };
    handle.on("change", onChange);
    e.unsubscribe = () => handle.off?.("change", onChange);
  }

  async function startParse(e) {
    const gen = e.gen;
    const bytes = e.bytes;
    e.bytes = null;
    parsing++;
    stats.parses++;
    stats.maxParsesInFlight = Math.max(stats.maxParsesInFlight, parsing);
    emit(e, { phase: "parsing" });
    try {
      await parse(e.id, bytes, e.url);
      if (!e.dead && e.gen === gen) {
        e.parsedBytes = bytes;
        e.retries = 0;
        emit(e, { phase: "ready", error: null });
      }
    } catch (err) {
      if (!e.dead && e.gen === gen) {
        stats.errors++;
        e.parsedBytes = bytes;
        emit(e, { phase: "error", error: message(err) });
      }
    }
    parsing--;
    if (!e.dead && e.gen === gen && e.dirty) {
      e.dirty = false;
      try {
        const next = read(e.handle);
        if (next !== bytes) {
          e.bytes = next;
          emit(e, { phase: "parse-queued", error: null });
        }
      } catch {
        // keep what is shown
      }
    }
    // one parse at a time, and let the page breathe between files
    await yieldToMain();
    pump();
  }

  function drop(e) {
    e.dead = true;
    if (e.retryTimer != null) timers.clearTimeout(e.retryTimer);
    e.retryTimer = null;
    e.unsubscribe?.();
    e.unsubscribe = null;
    entries.delete(e.id);
  }

  return {
    /** Want this object's GLB (from `url`) shown. Changing the url starts over. */
    ensure(id, url, priority = 0) {
      if (disposed) return;
      const e = entries.get(id);
      if (e && e.url === url) {
        if (e.priority !== priority) e.priority = priority;
        if (e.phase === "queued" || e.phase === "parse-queued") schedulePump();
        return;
      }
      if (e) drop(e);
      const entry = { id, url, priority, phase: "queued", error: null, retries: 0, retryTimer: null, gen: 1, dead: false, handle: null, bytes: null, parsedBytes: null, unsubscribe: null, dirty: false };
      entries.set(id, entry);
      emit(entry);
      schedulePump();
    },
    setPriority(id, priority) {
      const e = entries.get(id);
      if (e) e.priority = priority;
    },
    /** No longer wanted before it started (hidden again while queued): forget it. In-flight work finishes. */
    cancel(id) {
      const e = entries.get(id);
      if (!e) return false;
      if (e.phase === "queued" || (e.phase === "error" && !e.parsedBytes && e.retryTimer != null)) {
        drop(e);
        return true;
      }
      return false;
    },
    /** The object is gone (or points elsewhere): unsubscribe and forget. */
    remove(id) {
      const e = entries.get(id);
      if (e) drop(e);
    },
    has: (id) => entries.has(id),
    state(id) {
      const e = entries.get(id);
      return e ? { phase: e.phase, error: e.error, url: e.url } : null;
    },
    ids: () => [...entries.keys()],
    /** Handles currently subscribed to (loaded sources). */
    subscriptions: () => [...entries.values()].filter((e) => e.unsubscribe).length,
    /** How many are still on their way (queued, finding or parsing). */
    pending: () => [...entries.values()].filter((e) => LOADING.has(e.phase)).length,
    stats: () => ({ ...stats, inFlightFinds: finding, inFlightParses: parsing }),
    dispose() {
      disposed = true;
      for (const e of [...entries.values()]) drop(e);
    },
  };
}
