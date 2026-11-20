// scene.undo: Undo and Redo (HISTORY.md, TOOLS Decisions 2). What they take back is
// the editor's own writes only (the halo's handles, the inspector, transfer,
// add, remove: whatever wrote through ./editor.js), this viewer's, in the focus
// doc, as inverse changes (src/undo.js); a die's roll, a shuffle, a pause or
// a process's save is never on it. ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes,
// unless a field has the keys (its own text undo) or they come from a docked
// pane; the toolbar has both, named for the step they'd take. A package's
// own writes go on it through the "edits" service (EDITOR.md, "Undo"). Both are the
// editor's (../stage/bodies.js): only while editing. A step recorded
// there stays on the stack while the viewer looks, walks or sits, and is
// there to take back on coming back to Edit (if the doc still holds what it
// wrote: undo's compare-and-set).

import { fromEmbed } from "../embed.js";
import { isTyping } from "../keymap.js";
import { editor } from "./editor.js";
import { editing } from "../stage/bodies.js";

/** Which of undo and redo a keydown asks for, or null. Pure. */
export function undoKey(e) {
  if (!e || e.altKey || !(e.metaKey || e.ctrlKey)) return null;
  const k = String(e.key ?? "").toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) return "redo";
  return null;
}

function create(api) {
  const root = api.root;
  const take = (which) => {
    const f = api.focus();
    return f ? editor(f)[which]() : false;
  };

  api.listen(root, "keydown", (e) => {
    const which = undoKey(e);
    // undo is the editor's (../stage/bodies.js): only while editing
    if (!which || e.defaultPrevented || fromEmbed(e, root) || !editing(api.view.get())) return;
    if (isTyping(e.composedPath?.()[0] ?? e.target)) return;
    e.preventDefault();
    if (!e.repeat) take(which);
  });

  const command = (which, name) => ({
    id: which,
    name,
    group: "history",
    icon: which,
    edit: true,
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
