// The editor's writes (EDITOR.md, "Undo"). Its view plugins (the halo,
// handles, inspector and tree, transfer, add, the parts bin, dimensions,
// Frame's Set home view, Delete, Undo) write the focus doc through here, each
// write recorded from what the stage's change(fn) returns (its patches) onto
// this viewer's stacks for that doc, kept in the focus stage's `local.edits`
// (src/parts/undo-log.js). Nothing else is ever on them: a package's verb, a clock act
// or a process's save writes through its own api.change, unrecorded. What a
// package's module makes (a dropped doc laid out, a part, a template) is one
// step too: ./making.js.

import { EMPTY, createEdits } from "./undo-log.js";

/** An object's render doc as the recorder writes one: change(fn) → its patches. */
const writer = (h) => ({
  url: h.url,
  doc: () => h.doc(),
  change(fn) {
    let patches = [];
    h.change(fn, { patchCallback: (p) => void (patches = p) });
    return patches;
  },
});

/**
 * What a step did to a doc (./undo-log.js `judge`): the names of the objects it
 * removed whose contents a keeper holds, bound by the trait of an extension
 * whose plugin says `keeper` (CONVENTIONS.md, "Keepers"), read from `reg` (the
 * focus's registry("scene:extension"), at once).
 */
function judge(reg, { before, after }) {
  const gone = Object.keys(before?.objects ?? {}).filter((id) => !after?.objects?.[id]);
  if (!gone.length) return null;
  const traits = (reg?.filter?.((p) => !!p?.keeper) ?? []).flatMap((p) => (Array.isArray(p.traits) ? p.traits : []));
  return { kept: gone.filter((id) => traits.some((k) => before.objects[id]?.traits?.[k] != null)).map((id) => String(before.objects[id].name ?? id)) };
}

/**
 * The editor at the focus `f` (a view plugin's api.focus(), read now: its
 * steps stay with this doc wherever the focus goes). edit(fn, { label,
 * handle? }) writes fn as one step (on the scene, or on `handle`: an
 * object's render doc; or on `doc`, a doc as the recorder takes one, whose
 * change(fn) says what it wrote: a package's, through the "edits" service of
 * ./undo.js); edits(label) opens a step of several writes ({
 * change(fn, handle?), end() }); undo() and redo() take this viewer's last
 * step here back or again (false when there's none, or it has been changed
 * since); labels() names them.
 */
export function editor(f) {
  const { url, doc, change, local } = f;
  const e = createEdits({
    handle: { url, doc, change },
    store: { get: () => local.get().edits ?? EMPTY, swap: (fn) => local.swap((m) => ({ ...m, edits: fn(m.edits ?? EMPTY) })) },
    writable: f.writable,
    notify: (text) => f.use("notices")?.notify(text),
    judge: (part) => judge(f.registry("scene:extension"), part),
  });
  const edits = (label) => {
    const g = e.begin(label);
    return Object.freeze({ change: (fn, h) => g.change(fn, h && writer(h)), end: g.end });
  };
  return Object.freeze({
    /** fn as one step: on the scene, on `handle` (a DocHandle), or on `doc` (a recorder's doc as it is: { url, doc(), change(fn) → patches }) */
    edit(fn, { label, handle, doc } = {}) {
      if (doc) {
        const g = e.begin(label);
        g.change(fn, doc);
        g.end();
        return;
      }
      const g = edits(label);
      g.change(fn, handle);
      g.end();
    },
    edits,
    undo: () => e.take("undo"),
    redo: () => e.take("redo"),
    labels: e.labels,
  });
}

/** Add a doc as an object (the stage's addObject), as one step. @returns {Promise<string>} its id */
export async function add(f, input, opts) {
  const write = await f.addObject(input, opts);
  editor(f).edit(write, { label: "Add" });
  return write.id;
}
