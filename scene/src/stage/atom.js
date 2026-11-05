// One value that changes over time: the view's local state (STAGE.md, "Three
// places for state"). The value is a frozen plain object; swap(fn) replaces it
// with fn(old). Watchers hear about each swap after it happens, with the new
// and old values, so they compare what they care about and ignore the rest.

/**
 * @param {object} [init]
 * @returns {{ get(): object, swap(fn: (v: object) => object): object, watch(fn: (next: object, prev: object) => void): () => void }}
 */
export function createAtom(init = {}) {
  let value = Object.freeze({ ...init });
  const watchers = new Set();
  return {
    get: () => value,
    swap(fn) {
      const prev = value;
      const next = fn(prev);
      if (next === prev) return prev;
      value = Object.isFrozen(next) ? next : Object.freeze({ ...next });
      for (const w of [...watchers]) {
        try {
          w(value, prev);
        } catch (err) {
          console.warn("[scene] a local-state watcher failed", err);
        }
      }
      return value;
    },
    watch(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

/** swap(assoc(key, value)): one key set, the rest kept (no swap when it's already that). */
export const assoc = (key, v) => (m) => (m[key] === v ? m : { ...m, [key]: v });
