// scene.undo: Undo and Redo (HISTORY.md, TOOLS Decisions 2). What they take back is
// the editor's own writes only (the halo's handles, the inspector, transfer,
// add, remove: whatever wrote through ./editor.js), this viewer's, in the focus
// doc, as inverse changes (src/undo.js); a die's roll, a shuffle, a pause or
// a process's save is never on it. ⌘Z undoes, ⇧⌘Z redoes (Ctrl+Z, Ctrl+Shift+Z
// or Ctrl+Y off a Mac): the commands' shortcuts, which the key map runs in the key order
// (STAGE.md, "Keys": a field keeps its own text undo, a docked pane its own
// keys); the toolbar has both, named for the step they'd take. A package's
// own writes go on it through the "edits" service (EDITOR.md, "Undo"). Both are the
// editor's: only while editing. A step recorded
// there stays on the stack while the viewer looks, walks or sits, and is
// there to take back on coming back to Edit (if the doc still holds what it
// wrote: undo's compare-and-set).

import { editor } from "./editor.js";
import { onMac } from "./shortcuts.js";

/** Each command's shortcuts (./shortcuts.js): ⌘Z, ⇧⌘Z; Ctrl+Y redoes too off a Mac (⌘Y is the browser's History there). */
const shortcuts = (mac) => ({ undo: ["Mod+Z"], redo: ["Shift+Mod+Z", ...(mac ? [] : ["Mod+Y"])] });

function create(api) {
  const SHORTCUTS = shortcuts(onMac());
  const take = (which) => {
    const f = api.focus();
    return f ? editor(f)[which]() : false;
  };

  const command = (which, name) => ({
    id: which,
    name,
    group: "history",
    icon: which,
    shortcut: SHORTCUTS[which],
    hand: "edit",
    show: ["toolbar"],
    state: (target) => {
      if (target != null) return null;
      const f = api.focus();
      if (!f?.writable()) return { disabled: true, title: "view only" };
      const label = editor(f).labels()[which];
      return label ? { title: `${name} “${label}”` } : { disabled: true, title: `Nothing to ${which}` };
    },
    run: () => void take(which),
  });

  return {
    commands: [command("undo", "Undo"), command("redo", "Redo")],
    provides: {
      // EDITOR.md, "Undo": a package's own writes, as steps on this undo
      edits: () =>
        Object.freeze({
          /**
           * Write fn to `doc` ({ url, doc(), change(fn) → patches }: a doc a package edits for a
           * thing in the scene, e.g. a model an object shows; its patches are what the step takes
           * back) as one step of this viewer's in the focus doc. false: nothing written (no
           * focus, or the focus doc can't be written here), so the caller writes it itself.
           */
          edit(doc, fn, { label } = {}) {
            const f = api.focus();
            if (!f?.writable() || !doc || typeof doc.change !== "function" || typeof fn !== "function") return false;
            editor(f).edit(fn, { label, doc });
            return true;
          },
        }),
    },
  };
}

export default { create };
