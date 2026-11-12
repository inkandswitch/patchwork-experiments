// The traversal scene extension (scene:extension "traversal"): exits, in any
// activity. Built only from the scene's extension contract (scene/STAGE.md);
// exit.js is the trait and its rules, go.js the leaving. The verb, two ways
// (joints' pattern, for the same reasons):
//
// - on the use prompt, with F, from within arm's reach of the point looked at
//   (only the prompt says where the eye is);
// - on the menu and the inspector, with no key and no reach (F is Frame all
//   while editing, and a key map has no eye to measure from).
//
// Nothing is written, claimed or held: using an exit opens another document.

import { exitVerb } from "./exit.js";
import { go } from "./go.js";

function create(api) {
  const here = () => api.url ?? api.handle?.url ?? null;
  const state = (surface) => (target, ctx = {}) => {
    const v = exitVerb(api.scene(), target, { surface, here: here(), from: ctx.from, hit: ctx.hit });
    return v && { label: v.label };
  };
  /** Leave by `target`, if it leads somewhere now (read again: the doc may have changed since the verb was shown). */
  function leave(target) {
    const v = exitVerb(api.scene(), target, { surface: "menu", here: here() });
    if (v) go(api, v.to);
  }
  return {
    commands: [
      // the use prompt's: F, within reach of the eye
      { id: "use", name: "Go", key: "f", show: ["use"], state: state("use"), run: leave },
      // the menu's and the inspector's: no key, no reach
      { id: "exit", name: "Go", show: ["menu", "inspector"], state: state("menu"), run: leave },
    ],
  };
}

export default { create };
