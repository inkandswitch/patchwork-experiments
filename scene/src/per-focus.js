// What a view plugin keeps per focus (API.md, "View plugins").
//
// api.focus() is the focus stage's api for a view plugin, a new one each time
// the focus moves; what was acquired through one (world layers, labels,
// watchers on that stage) goes when the focus leaves, so whatever is built on
// them is built again for the next.

/**
 * `make(facet)` once per facet, on asking; its dispose() (if it has one) runs
 * once, as that facet goes or on the getter's `dispose()`, which lets go of
 * what is made now (asked again, it is made again).
 * @template T
 * @param {{ focus(): object | null }} api  a view plugin's
 * @param {(facet: object) => T} make
 * @returns {(() => T | null) & { dispose(): void }} the current focus's (null while there is none)
 */
export function perFocus(api, make) {
  let at = null;
  let value = null;
  let letGo = null; // the made value's dispose, once
  const get = () => {
    const f = api.focus();
    if (f !== at) {
      at = f;
      const made = (value = f ? make(f) : null);
      letGo = null;
      if (typeof made?.dispose === "function") {
        let done = false;
        const once = (letGo = () => void (done || ((done = true), made.dispose())));
        f.signal?.addEventListener?.("abort", once, { once: true });
      }
    }
    return value;
  };
  get.dispose = () => {
    const give = letGo;
    at = value = letGo = null;
    give?.();
  };
  return get;
}

/** The focus stage's reader (API.md, "View plugins": `path`), for a view plugin's `api`; null before there is one. */
export const focusReader = (api) => api.path({ focus: true })[0] ?? null;

/**
 * The focus stage's api as one object, for code written for a stage's api
 * (the inspector's fields, the tree): each member read from api.focus() as it
 * is now, else from the view plugin's api. Never across an await (it would
 * write where the focus has gone): take one api.focus() for that.
 * @param {{ focus(): object | null }} api  a view plugin's
 */
export function atFocus(api) {
  return new Proxy(Object.freeze({}), {
    get: (_, k) => {
      const f = api.focus();
      return f && k in f ? f[k] : api[k];
    },
  });
}
