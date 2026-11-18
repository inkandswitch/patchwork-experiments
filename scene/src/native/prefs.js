// scene.prefs (native, a view plugin): the viewer's display prefs, provided as
// "prefs" (STAGE.md, "Native services"): get(key, fallback) is the viewer's,
// else the focus doc's `doc.view[key]`, else the fallback; set(key, value)
// (undefined: unset) is kept per scene in localStorage, another tab's heard,
// and published as view["scene.prefs"]; watch(fn) hears each change.

function create(api) {
  const key = `scene-prefs:${api.url}`;
  const read = () => {
    try {
      const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  };
  let prefs = null;
  const watchers = new Set();
  function put(next, store = true) {
    api.view.set((prefs = Object.freeze({ ...next })));
    try {
      if (store) globalThis.localStorage?.setItem(key, JSON.stringify(prefs));
    } catch {
      // private window, or full: this viewer's choice lasts the session
    }
    for (const fn of [...watchers]) fn(prefs);
  }
  put(read(), false);
  api.listen(globalThis, "storage", (e) => e.key === key && put(read(), false));
  const prefsFor = ({ signal }) =>
    Object.freeze({
      get: (k, fallback) => prefs[k] ?? api.focus()?.doc().view?.[k] ?? fallback,
      set(k, value) {
        if (signal.aborted || typeof k !== "string" || (value === undefined ? !(k in prefs) : prefs[k] === value)) return;
        const { [k]: _, ...rest } = prefs;
        put(value === undefined ? rest : { ...rest, [k]: value });
      },
      watch: (fn) => (signal.aborted ? () => {} : (watchers.add(fn), signal.addEventListener("abort", () => watchers.delete(fn)), () => watchers.delete(fn))),
    });
  return { provides: { prefs: prefsFor } };
}

export default { create };
