// scene.select: the selection (STAGE.md, "The input chain").
//
// - Select is the first entry of every target's menu (scene.menu puts it
//   there): the deliberate select, in a game too.
// - A plain click selecting is the Edit hand's (scene.edit, ./edit.js),
//   which takes a click before the chain unless a widget is under it: while
//   editing a click selects before any package's click verb (HISTORY.md,
//   Kernel steps 1 and 2). Without the editor a plain click
//   selects nothing (STAGE.md, "Hands"). Select is everyone's, whatever the
//   viewer holds; what a selection shows beyond its box (the halo's handles,
//   the inspector) is the editor's. Remove (Delete) is an edit, so the
//   editor's too.
// - Where a selection may be is ../selection.js (H10): an element of the
//   focus stage, which is where all this works (api.focus()). With one stage
//   that's any object.
// - local.selected is this view's selection: a target (STAGE.md, "Targets
//   and refs"), an object or group id, or a ref such as "dimension:<id>" that
//   another extension made selectable, or null. A click on nothing clears
//   whatever it is. An object selection is pruned when its object goes; a
//   ref is its owner's to let go of.
// - Draws the selection box (accent) in a world layer (./boxes.js); it
//   follows held poses. Everyone else's boxes are scene.others', a part of
//   every doc (./others.js), drawn wherever their doc is, whatever the focus
//   (STAGE.md, "Views, stages and links", "Presence where it is").
// - Tells peers what is selected and hovered (presence "selected", "hovered").
// - Asks the stage to load the selection first (its facet's focus(ids)), if it's an object.
// - Commands: Remove (Delete, Backspace; objects only), Select. Escape
//   deselects (stage/ladder.js: the Edit hand's escape, or the view's own
//   with no hand held), not a key.

import { editor } from "./editor.js";
import { boxes } from "./boxes.js";
import { perFocus } from "./per-focus.js";

const ACCENT = [0.2, 0.9, 0.75];

const isGroupObj = (o) => o?.kind === "group";
// "<kind>:<id>": a target another extension owns (an object id has no colon)
const isRef = (target) => typeof target === "string" && target.includes(":");

function confirmRemove(message) {
  try {
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) !== false : true;
  } catch {
    return true;
  }
}

export function create(api) {
  // the focus stage's element of the selection
  const selected = () => api.focus()?.view.get().selected ?? null;
  // (drawn over anyone else's box on the same object: scene.others'), in the focus stage
  const drawn = perFocus(api, (f) =>
    boxes(f, (objects, theme) => {
      const id = f.view.get().selected ?? null;
      return id && objects[id] ? [{ key: "self", id, rgb: theme.accent ?? ACCENT }] : [];
    }, { renderOrder: 1 }),
  );

  /** Select a target of the focus stage's (null: nothing); the view keeps it as a path (stage/view.js). */
  const select = (id) => api.focus()?.view.select(id ?? null);

  function update(scene, local, prev, view) {
    const f = api.focus();
    if (!f) return;
    const sel = view.selected ?? null;
    // the selection's object went (removed here or by a peer); a ref that
    // names no object is left to the extension that made it
    if (sel != null && !scene.objects?.[sel] && (!isRef(sel) || prev?.scene?.objects?.[sel])) {
      select(null);
      return;
    }
    const was = prev?.view;
    if (!was || sel !== (was.selected ?? null)) {
      // peers are told any target; their surfaces mark only what they know
      f.presence.set("selected", sel ?? undefined);
      f.focus(sel != null && scene.objects?.[sel] ? [sel] : []);
    }
    if (!was || view.hovered !== was.hovered) f.presence.set("hovered", view.hovered ?? undefined);
    // only the hover (or something else of no concern here) changed
    if (was && scene === prev.scene && (local !== prev.local || view !== was) && sel === (was.selected ?? null) && view.theme === was.theme) return;
    // the doc, the selection or the theme changed, or content loaded (same scene and local)
    drawn()?.refresh();
  }

  const commands = [
    {
      id: "select",
      name: "Select",
      show: ["menu"],
      state: (target, { scene, view }) => {
        if (target == null || !scene?.objects?.[target]) return null;
        return view?.selected === target ? { disabled: true, title: "Already selected" } : { title: "Select this" };
      },
      run: (target) => select(target),
    },
    {
      id: "remove",
      edit: true,
      name: "Remove",
      key: ["Delete", "Backspace"],
      show: ["menu", "inspector"],
      state: (target, { scene }) => {
        const o = target != null ? scene?.objects?.[target] : null;
        if (!o) return null;
        return { title: isGroupObj(o) ? "Remove this group and everything in it" : "Remove this from the scene" };
      },
      run: (target) => removeObject(target),
    },
  ];

  /** Remove an object; a group goes with everything in it (after a confirm). */
  function removeObject(id) {
    const f = api.focus();
    const snap = f?.scene();
    const o = snap?.objects?.[id];
    if (!o) return false;
    const plan = f.ops.removeObjects(snap, [id]);
    if (!plan || plan.ok === false) return false;
    const n = plan.within?.length ?? 0;
    if (n > 0 && !confirmRemove(`Remove “${o.name || "Group"}” and the ${n} object${n === 1 ? "" : "s"} in it?`)) return false;
    editor(f).edit(f.remove([id]), { label: "Delete" });
    const gone = new Set(plan.ids ?? [id]);
    if (gone.has(selected())) select(null);
    return true;
  }

  return {
    update,
    commands,
  };
}

export default { create };
