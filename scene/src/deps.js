// Watches the docs a provider's build() reads besides its source (the list its
// optional dependencies(doc) returns). Keeps one subscription per listed doc,
// adding and dropping them as the list changes, and reports each one's heads.
// A doc that can't be loaded is retried with backoff and reads as no heads
// ([]) meanwhile; it never blocks a build. No automerge here beyond
// repo.find / handle.heads / handle.on, so it is testable with the fake repo.
//
// A dependency can be keyed by something narrower than its heads: `keyOf(url,
// handle)` may return a string, recorded as ["fp:<string>"] in place of the
// heads, so edits to the doc that don't change that string don't rebuild
// anything (a scene-render dependency is keyed by its glbUrl, so its status
// writes are invisible downstream).
//
// A dependency can also be fixed at a version (`fixedHeadsOf(url)` gives
// heads, from the scene object's `at.deps`): it is then recorded from a
// read-only view at those heads, so edits to the live doc change nothing and
// don't call onChange. It is still loaded (the view comes from the live
// handle), and counts as not ready until this replica has those heads.

import { viewAt } from "./build.js";
import { sortedHeads } from "./staleness.js";

const RETRY_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * @param {object} o
 * @param {object} o.repo
 * @param {() => void} o.onChange   a dependency loaded, failed, or changed
 * @param {(url: string, handle: object) => string | null} [o.keyOf]
 *        a narrower key for a loaded dependency; null = use its heads
 * @param {(url: string) => string[] | null} [o.fixedHeadsOf]
 *        heads to read a dependency at instead of its latest; null = latest
 * @param {{ setTimeout, clearTimeout }} [o.timers]
 * @param {() => number} [o.now]
 */
export function createDependencyWatcher({ repo, onChange, keyOf, fixedHeadsOf, timers = globalThis, now = Date.now }) {
  /** What a loaded dependency records: ["fp:<key>"] when keyOf gives one, else its sorted heads. */
  function recorded(url, handle, heads) {
    if (typeof keyOf === "function") {
      try {
        const k = keyOf(url, handle);
        if (k != null) return [`fp:${k}`];
      } catch (err) {
        console.warn("[scene] dependency key threw; using heads", err);
      }
    }
    return sortedHeads(heads);
  }

  function fixedHeads(url) {
    const h = typeof fixedHeadsOf === "function" ? fixedHeadsOf(url) : null;
    return Array.isArray(h) && h.length ? sortedHeads(h) : null;
  }

  /**
   * What a loaded dependency records right now: from its view when it is
   * fixed (null if this replica doesn't have those heads yet), else live.
   */
  function current(url, handle) {
    const fixed = fixedHeads(url);
    if (!fixed) return recorded(url, handle, handle.heads?.() ?? []);
    const view = viewAt(handle, fixed);
    return view ? recorded(url, view, fixed) : null;
  }

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
            if (rec.dead || disposed) return;
            // A fixed dependency only matters once its version arrives.
            if (fixedHeads(url)) {
              const cur = JSON.stringify(current(url, handle));
              if (cur === rec.lastFixed) return;
              rec.lastFixed = cur;
            }
            onChange?.();
          };
          handle.on("change", listener);
          rec.off = () => handle.off("change", listener);
          rec.handle = handle;
          rec.loadHeads = sortedHeads(handle.heads?.() ?? []);
          rec.lastFixed = fixedHeads(url) ? JSON.stringify(current(url, handle)) : null;
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
        const rec = { handle: null, loadHeads: null, lastFixed: null, pending: false, since: null, failures: 0, retry: null, off: null, dead: false };
        deps.set(url, rec);
        load(url, rec);
        changed = true;
      }
      return changed;
    },
    urls: () => [...deps.keys()].sort(),
    /**
     * { url: sorted heads (or ["fp:<key>"]) } for every watched doc; [] for one
     * not loaded (or fixed at heads this replica doesn't have yet).
     */
    snapshot() {
      const out = {};
      for (const url of [...deps.keys()].sort()) {
        const h = deps.get(url).handle;
        out[url] = (h && current(url, h)) ?? [];
      }
      return out;
    },
    /** Loaded, and (if fixed) at heads this replica has: what snapshot() says is real. */
    ready: (url) => {
      const h = deps.get(url)?.handle;
      return !!h && current(url, h) != null;
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
    /**
     * Sorted heads the doc had when it loaded (what a find() racing it read), or
     * null if not loaded. A keyed dependency gives its current key instead: the
     * key can't be recomputed for an older version of the doc.
     */
    headsAtLoad: (url) => {
      const rec = deps.get(url);
      if (!rec?.handle) return null;
      if (fixedHeads(url)) return current(url, rec.handle);
      return recorded(url, rec.handle, rec.loadHeads);
    },
    dispose() {
      disposed = true;
      for (const url of [...deps.keys()]) drop(url);
    },
  };
}
