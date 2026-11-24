// scene.drops: what is dragged, dropped or pasted into the view, heard once
// (EDITOR.md, "Drops"). While the Edit hand is held it listens to the view's
// root for drags, drops and pastes, and offers each, in running order, to
// every instance's contribution until one says true:
//
//   dropping: { over(e) → boolean, leave?(), drop(e) → boolean }
//     over: a drag moved over the view; true, it would take a drop here (it
//     shows where); false, it hides what it showed. leave: the drag left the
//     view, ended, or another took it. drop: take it; true, it is taken.
//   pasting: (e) → boolean
//     a paste outside a field; true, it is taken.
//
// What isn't the view's never reaches them: anything an embedded document
// or something under the pointer took first (a drawer's tab strip, an
// outline row), and a paste into a field. A drag or paste nobody takes is
// the browser's. Which handler goes first is the running order
// (scene.transfer's copied object before scene.add's document link).

import { fromEmbed } from "../embed.js";
import { isTyping, whileHolding } from "../stage/public.js";
import { EDIT } from "./editing.js";

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
      console.warn("[scene] a drop or paste handler failed", err);
    }
  }
  return null;
}

function create(api) {
  const root = api.root;
  /** Every instance's `name` contribution, in running order (the focus stage's, then the view plugins'). */
  const offered = (name, ok) => api.collect(name).map((x) => x.value).filter(ok);
  const dropping = () => offered("dropping", (h) => typeof h?.over === "function" && typeof h.drop === "function");
  const pasting = () => offered("pasting", (h) => typeof h === "function");
  let over = null; // the handler the drag is over now
  const leaveAll = () => {
    over = null;
    firstTaker(dropping(), (h) => void h.leave?.());
  };

  whileHolding(api, EDIT, () => {
    const offs = [
      api.listen(root, "dragover", (e) => {
        if (e.defaultPrevented || fromEmbed(e, root)) return;
        const h = firstTaker(dropping(), (x) => x.over(e));
        if (over && over !== h) firstTaker([over], (x) => void x.leave?.());
        over = h;
        if (!h) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }),
      api.listen(root, "dragleave", (e) => {
        if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) leaveAll();
      }),
      // any drop ends the drag, whoever takes it (heard first, so a row's own drop can't skip it)
      api.listen(root, "drop", leaveAll, { capture: true }),
      api.listen(root, "drop", (e) => {
        if (e.defaultPrevented || fromEmbed(e, root)) return;
        if (firstTaker(dropping(), (x) => x.drop(e))) e.preventDefault();
      }),
      api.listen(root, "paste", (e) => {
        if (e.defaultPrevented || fromEmbed(e, root) || isTyping(e.composedPath?.()[0] ?? e.target)) return;
        if (firstTaker(pasting(), (x) => x(e))) e.preventDefault();
      }),
    ];
    return () => {
      for (const off of offs) off();
      leaveAll();
    };
  });
  return {};
}

export default { create };
