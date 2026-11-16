// The stage's own parts (STAGE.md, "Edit"): the extension modules this
// package ships that edit the scene as the stage (the halo, the inspector
// and its tree, add, the parts bin, transfer, dimensions, Frame's Set home
// view, Delete, Undo). Only these get `api.edit`, `api.edits`, `api.undo`
// and `api.redo`; every other extension's api has none, so a package's verb
// can't put itself on anyone's undo stack (TOOLS.md, Decisions 2).
//
// A part says so by its module being passed through `own()` here. The mark
// is this module's own set, and this module is the scene package's: another
// package can't import it (packages share nothing at build time), and a
// copy bundled elsewhere would be a different set. The marked module is
// frozen as it's marked, so a package that reaches it at run time (through
// the plugin registry's load) can't swap its `create` for its own and be
// handed the edit api. So it holds by construction, not by naming: a plugin
// id that starts with "scene." means nothing here.

const OWN = new WeakSet();

/** Mark a part's module as the stage's own, frozen, and give it back. */
export function own(module) {
  if (module && typeof module === "object") OWN.add(Object.freeze(module));
  return module;
}

/** Is this extension module one of the stage's own parts? */
export const isOwn = (module) => !!module && typeof module === "object" && OWN.has(module);
