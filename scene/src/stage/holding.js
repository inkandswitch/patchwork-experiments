// What lasts while a hand of a kind is held (STAGE.md, "Hands"): a view
// plugin's chrome for a hand another plugin picks up and puts down (the
// editor's parts for the Edit hand). Built on the view plugin's api alone:
// `view.watch` and `view.get`, read by `holding`.

import { holding } from "./bodies.js";

/**
 * While a hand of `kind` is held in the view, what `make()` made: made as
 * the first is picked up (at once, if one is held already), disposed as the
 * last is put down, however it goes (its owner, Escape, its plugin
 * stopping), or as this plugin stops. What `make` answers is disposed by
 * its `dispose()`, else, if it is a function, by calling it; the rest is the
 * caller's (an `update`, an `input`). A throw in either is warned of and
 * counts as nothing made.
 * @template T
 * @param {{ signal: AbortSignal, view: { get(): object, watch(fn: Function, select?: Function): unknown } }} api  a view plugin's
 * @param {string} kind
 * @param {() => T} make
 * @returns {() => T | null} what is made now, or null while no such hand is held
 */
export function whileHolding(api, kind, make) {
  let made = null;
  let on = false;
  const warn = (what, err) => console.warn(`[scene] ${api.id ?? "a view plugin"}: what it makes while holding “${kind}” failed to ${what}`, err);
  function drop() {
    const m = made;
    made = null;
    on = false;
    try {
      if (typeof m?.dispose === "function") m.dispose();
      else if (typeof m === "function") m();
    } catch (err) {
      warn("dispose", err);
    }
  }
  function sync(view) {
    const now = !api.signal?.aborted && holding(view, kind);
    if (now === on) return;
    if (!now) return drop();
    on = true;
    try {
      made = make() ?? null;
    } catch (err) {
      warn("make", err);
      made = null;
    }
  }
  api.view.watch(sync, (v) => holding(v, kind));
  api.signal?.addEventListener?.("abort", drop, { once: true });
  sync(api.view.get());
  return () => made;
}
