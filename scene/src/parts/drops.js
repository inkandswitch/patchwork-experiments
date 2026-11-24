// scene.drops: what is dragged, dropped, pasted or copied in the view, heard
// once (EDITOR.md, "Drops"). It listens to the view's root, and offers each
// event, in running order, to every view plugin's contribution until one
// says true (the DOM event's level, the editor's own; a package lays out a
// dropped document through its `drops` metadata instead):
//
//   dropping: { wants(dataTransfer) → boolean, over(e) → boolean, leave?(), drop(e) → boolean }
//     wants: is this drag one it would take (its types, all a drag shows
//     before the drop)? over: a drag moved over the view; true, it would
//     take a drop here (it shows where); false, it hides what it showed.
//     leave: the drag left the view, ended, or another took it. drop: take
//     it; true, it is taken.
//   pasting: (e) → boolean   a paste outside a field; true, it is taken
//   copying: (e) → boolean   a copy outside a field (⌘C, Edit ▸ Copy); true, it wrote the clipboard
//
// Drops are offered while the Edit hand is held, on a stage that can be
// written. Otherwise a drag some part wants is refused, the browser never
// opening it in Patchwork's place, and a notice says why and what to do.
// Pastes and copies are heard only while editing; one nobody takes is the
// browser's, as is everything an embedded document or something under the
// pointer took first (a drawer's tab strip, an outline row) and a paste or
// copy in a field.

import { fromEmbed } from "../embed.js";
import { isTyping } from "../stage/public.js";
import { whileEditing } from "./editing.js";

/**
 * The first of `handlers` that `offer` says true for (a throw is no), or null. Pure.
 * @template H
 * @param {H[]} handlers
 * @param {(h: H) => unknown} offer
 * @returns {H | null}
 */
export function firstTaker(handlers, offer) {
  for (const h of handlers) {
    try {
      if (offer(h) === true) return h;
    } catch (err) {
      console.warn("[scene] a drop, paste or copy handler failed", err);
    }
  }
  return null;
}

/** Why a drag is refused here, or null: the editor is down, or the stage can't be written. Pure. */
export function refusal(editing, writable) {
  if (!editing) return "To add this to the scene, pick up Edit first.";
  if (!writable) return "This scene is view-only here: it can't be added to.";
  return null;
}

function create(api) {
  const root = api.root;
  /** Every view plugin's `name` contribution, in running order (an extension's is never offered). */
  const offered = (name, ok) =>
    api
      .collect(name)
      .filter((x) => api.registry("scene:view")?.has?.(x.id))
      .map((x) => x.value)
      .filter(ok);
  const dropping = () => offered("dropping", (h) => typeof h?.wants === "function" && typeof h.over === "function" && typeof h.drop === "function");
  const handlers = (name) => () => offered(name, (h) => typeof h === "function");
  let over = null; // the handler the drag is over now
  let told = false; // this drag's refusal was said
  const leaveAll = () => {
    over = null;
    firstTaker(dropping(), (h) => void h.leave?.());
  };
  // pastes and copies are the editor's: heard while the Edit hand is held
  const clipboard = (offer) => (e) => {
    if (e.defaultPrevented || fromEmbed(e, root) || isTyping(e.composedPath?.()[0] ?? e.target)) return;
    if (firstTaker(offer(), (x) => x(e))) e.preventDefault();
  };
  const editing = whileEditing(api, () => {
    const offs = [api.listen(root, "paste", clipboard(handlers("pasting"))), api.listen(root, "copy", clipboard(handlers("copying")))];
    return () => {
      for (const off of offs) off();
      leaveAll();
    };
  });
  /** Why a drag of these types is refused here (refusal), or null; null too for one no part wants. */
  const refused = (dt) => {
    const why = refusal(!!editing(), api.focus()?.writable() ?? false);
    return why && dropping().some((h) => firstTaker([h], (x) => x.wants(dt))) ? why : null;
  };
  const refuse = (e, why) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    if (!told) api.use("notices")?.notify(why, "info");
    told = true;
  };

  api.listen(root, "dragover", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root)) return;
    const why = refused(e.dataTransfer);
    if (why) return refuse(e, why);
    if (!editing()) return;
    const h = firstTaker(dropping(), (x) => x.over(e));
    if (over && over !== h) firstTaker([over], (x) => void x.leave?.());
    over = h;
    if (!h) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  api.listen(root, "dragleave", (e) => {
    if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
    leaveAll();
    told = false;
  });
  // any drop ends the drag, whoever takes it (heard first, so a row's own drop can't skip it)
  api.listen(root, "drop", leaveAll, { capture: true });
  api.listen(root, "drop", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root)) return;
    const why = refused(e.dataTransfer);
    if (why) refuse(e, why);
    else if (editing() && firstTaker(dropping(), (x) => x.drop(e))) e.preventDefault();
    told = false;
  });
  return {};
}

export default { create };
