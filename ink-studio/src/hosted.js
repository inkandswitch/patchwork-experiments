// An ink-scene doc's handle as its editor gets it inside a scene: every write
// goes on the scene's undo (scene EDITOR.md, "Undo") as one step, through the
// scene's `edits` service. Copied from openscad/src/scene/hosted.ts
// (hostedHandle, undoablePatches): packages don't import each other.

/** What the person wrote, of a change's patches: not Patchwork's own `@` keys, which undo leaves alone. */
export const undoablePatches = (patches) => patches.filter((p) => !String(p.path[0]).startsWith("@"));

/**
 * @param {object} handle  the ink-scene doc's handle
 * @param {() => ({ edit(doc, fn, o?): boolean } | null)} edits  the scene's `edits` service, when there is one
 * Without it, where it refuses (the scene can't be written here), or for a
 * change with options of its own, the write goes to the doc as it would anyway.
 */
export function hostedHandle(handle, edits) {
  const doc = {
    url: handle.url,
    doc: () => handle.doc(),
    change(fn) {
      let patches = [];
      handle.change(fn, { patchCallback: (p) => void (patches = p) });
      return undoablePatches(patches);
    },
  };
  const change = (fn, opts) => {
    if (opts || !edits()?.edit(doc, fn, { label: `Edit ${handle.doc()?.title || "ink scene"}` })) handle.change(fn, opts);
  };
  return new Proxy(handle, {
    get(target, key) {
      if (key === "change") return change;
      // a handle the scene found is ready (automerge-codemirror asks; a stand-in handle may not say)
      if (key === "isReady" && typeof target.isReady !== "function") return () => true;
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
