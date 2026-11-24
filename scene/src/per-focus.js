// What a view plugin keeps per focus (STAGE.md, "View plugins").
//
// api.focus() is the focus stage's api for a view plugin, a new one each time
// the focus moves; what was acquired through one (world layers, labels,
// watchers on that stage) goes when the focus leaves, so whatever is built on
// them is built again for the next.

/**
 * `make(facet)` once per facet, on asking; its dispose() (if it has one) runs
 * as that facet goes.
 * @template T
 * @param {{ focus(): object | null }} api  a view plugin's
 * @param {(facet: object) => T} make
 * @returns {() => T | null} the current focus's (null while there is none)
 */
export function perFocus(api, make) {
  let at = null;
  let value = null;
  return () => {
    const f = api.focus();
    if (f !== at) {
      at = f;
      const made = (value = f ? make(f) : null);
      if (typeof made?.dispose === "function") f.signal?.addEventListener?.("abort", () => made.dispose(), { once: true });
    }
    return value;
  };
}

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
