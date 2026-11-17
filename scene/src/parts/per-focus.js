// What a view plugin keeps per focus (STAGE.md, "View plugins").
//
// A view plugin runs whatever the focus; api.focus() is the focus stage's
// facet for it, a new one each time the focus moves. What it acquired
// through a facet (world layers, labels, watchers on that stage) the stage
// gives back when the focus leaves, so whatever is built on them is built
// again for the next facet: perFocus(api, make) makes it, once per facet, on
// asking, and calls its dispose() (if it has one) when that facet is let go
// (once the focus has left and nothing is held through it).

/**
 * @template T
 * @param {{ focus(): object | null }} api  a view plugin's
 * @param {(facet: object) => T} make
 * @returns {() => T | null} the current focus's (null while there is no focus)
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

const INPUT = ["press", "click", "menu", "key", "keyup", "wheel", "widgetAt", "cursor"];

/**
 * An input that hands each event to the current focus's (`get()?.input`):
 * for a view plugin whose input is all its focus's (the halo's handles,
 * Measure's tool). One that answers nothing passes the event on.
 * @param {() => { input?: object } | null} get
 */
export function focusInput(get) {
  const out = {};
  for (const k of INPUT) out[k] = (ev) => get()?.input?.[k]?.(ev) ?? null;
  // (not frozen: the stage hears it through a proxy in its frame)
  return out;
}

/**
 * The focus facet as one object, a stage's api as code written for one
 * expects it (the inspector's fields, the tree, the copy rule): each member
 * is read from the focus as it is now (api.focus()), and what a facet
 * leaves out (notify, the registry) from the view plugin's api. What is
 * acquired through it is acquired through the facet of the moment, and goes
 * when the focus leaves.
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
