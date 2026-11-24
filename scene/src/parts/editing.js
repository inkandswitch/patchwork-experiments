// The Edit hand, as the editor's parts name it (EDITOR.md, "The Edit hand").
//
// Editing is holding a hand of kind EDIT (./edit.js picks it up and puts it
// down). The editor's commands say `hand: EDIT`, so they apply only while it
// is held (STAGE.md, "Commands"); its chrome (the inspector's pane, the bar's
// editor cluster, the grid, axes and bounds, the knobs, the drawer's tabs
// docked, the start screen, copy and paste) is made with `whileEditing(api,
// make)` as it is picked up and disposed as it is put down, so no part tests
// the hands for its chrome.

import { holding } from "../stage/public.js";

/** The Edit hand's kind: what the editor's commands name. */
export const EDIT = "edit";

/** The Edit hand's name: what the body chip and peers show while it is held. */
export const EDIT_HAND = "Edit";

/**
 * While the Edit hand is held in the view, what `make()` made: made as it is
 * picked up (at once, if it is held already), disposed as it is put down,
 * however it goes (its owner, Escape, its plugin stopping; `make` itself
 * putting it down), or as this plugin stops. What `make` answers is disposed
 * by its `dispose()`, else, if it is a function, by calling it; the rest is
 * the caller's (an `update`, an `input`). A throw in either is warned of and
 * counts as nothing made. Built on the view plugin's api alone.
 * @template T
 * @param {{ id?: string, signal: AbortSignal, view: { get(): object, watch(fn: Function, select?: Function): unknown } }} api  a view plugin's
 * @param {() => T} make
 * @returns {() => T | null} what is made now, or null while the Edit hand isn't held
 */
export function whileEditing(api, make) {
  let made = null;
  let on = false;
  const held = (view) => !api.signal?.aborted && holding(view, EDIT);
  const warn = (what, err) => console.warn(`[scene] ${api.id ?? "a view plugin"}: what it makes while editing failed to ${what}`, err);
  const dispose = (m) => {
    try {
      if (typeof m?.dispose === "function") m.dispose();
      else if (typeof m === "function") m();
    } catch (err) {
      warn("dispose", err);
    }
  };
  function drop() {
    const m = made;
    made = null;
    on = false;
    dispose(m);
  }
  function sync(view) {
    const now = held(view);
    if (now === on) return;
    if (!now) return drop();
    on = true;
    let m = null;
    try {
      m = make() ?? null;
    } catch (err) {
      warn("make", err);
    }
    // (make may have put the hand down as it ran: then what it made goes at once)
    if (on && held(api.view.get())) made = m;
    else {
      on = false;
      dispose(m);
    }
  }
  api.view.watch(sync, held);
  api.signal?.addEventListener?.("abort", drop, { once: true });
  sync(api.view.get());
  return () => made;
}
