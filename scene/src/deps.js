// Watches the docs a provider's build() reads besides its source (the list its
// optional dependencies(doc) returns). Keeps one subscription per listed doc,
// adding and dropping them as the list changes, and reports each one's heads.
// A doc that can't be loaded is retried with backoff and reads as no heads
// ([]) meanwhile; it never blocks a build. No automerge here beyond
// repo.find / handle.heads / handle.on, so it is testable with the fake repo.

import { sortedHeads } from "./staleness.js";

const RETRY_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * @param {object} o
 * @param {object} o.repo
 * @param {() => void} o.onChange   a dependency loaded, failed, or changed
 * @param {{ setTimeout, clearTimeout }} [o.timers]
 * @param {() => number} [o.now]
 */
export function createDependencyWatcher({ repo, onChange, timers = globalThis, now = Date.now }) {
  const deps = new Map(); // url → { handle, pending, since, failures, retry, off }
  let disposed = false;

  function drop(url) {
    const rec = deps.get(url);
    if (!rec) return;
    rec.dead = true;
    if (rec.retry != null) timers.clearTimeout(rec.retry);
    rec.off?.();
    deps.delete(url);
  }

  function load(url, rec) {
    rec.pending = true;
    rec.since = now();
    Promise.resolve()
      .then(() => repo.find(url))
      .then(
        (handle) => {
          if (rec.dead || disposed) return;
          const listener = () => {
            if (!rec.dead && !disposed) onChange?.();
          };
          handle.on("change", listener);
          rec.off = () => handle.off("change", listener);
          rec.handle = handle;
          rec.loadHeads = sortedHeads(handle.heads?.() ?? []);
          rec.pending = false;
          rec.failures = 0;
          onChange?.();
        },
        () => {
          if (rec.dead || disposed) return;
          rec.pending = false;
          const wait = Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** rec.failures++);
          rec.retry = timers.setTimeout(() => {
            rec.retry = null;
            if (!rec.dead && !disposed) load(url, rec);
          }, wait);
          onChange?.(); // anything waiting on it can go ahead without it
        },
      );
  }

  return {
    /** Watch exactly these urls. Returns true if the set changed. */
    set(urls) {
      if (disposed) return false;
      const next = new Set((urls ?? []).filter((u) => typeof u === "string" && u));
      let changed = false;
      for (const url of [...deps.keys()]) {
        if (!next.has(url)) {
          drop(url);
          changed = true;
        }
      }
      for (const url of next) {
        if (deps.has(url)) continue;
        const rec = { handle: null, loadHeads: null, pending: false, since: null, failures: 0, retry: null, off: null, dead: false };
        deps.set(url, rec);
        load(url, rec);
        changed = true;
      }
      return changed;
    },
    urls: () => [...deps.keys()].sort(),
    /** { url: sorted heads } for every watched doc; [] for one not loaded. */
    snapshot() {
      const out = {};
      for (const url of [...deps.keys()].sort()) {
        const h = deps.get(url).handle;
        out[url] = h ? sortedHeads(h.heads?.() ?? []) : [];
      }
      return out;
    },
    /** When the oldest still-in-flight FIRST load started, or null if none is (retries don't count). */
    pendingSince() {
      let t = null;
      for (const rec of deps.values()) if (rec.pending && rec.failures === 0 && !rec.handle && (t == null || rec.since < t)) t = rec.since;
      return t;
    },
    /** Loaded handle for a url, if any. */
    handle: (url) => deps.get(url)?.handle ?? null,
    /** True while a doc that failed to load is waiting to be retried (or being retried). */
    failed: (url) => {
      const rec = deps.get(url);
      return !!rec && !rec.handle && rec.failures > 0;
    },
    /** Sorted heads the doc had when it loaded (what a find() racing it read), or null if not loaded. */
    headsAtLoad: (url) => {
      const rec = deps.get(url);
      return rec?.handle ? [...rec.loadHeads] : null;
    },
    dispose() {
      disposed = true;
      for (const url of [...deps.keys()]) drop(url);
    },
  };
}
