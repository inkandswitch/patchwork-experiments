// scene.edit: the Edit hand, the editor's (STAGE.md, "Hands"; HISTORY.md,
// Kernel steps 1 and 2). An ordinary hand (api.hand): editing(view) is "a
// hand of kind edit is held" (../stage/bodies.js). The body chip's Edit runs
// its `edit` command, and `view.start.edit` picks it up on arriving. While
// held, a click selects at the focus (on nothing it clears, outside the focus
// it selects nothing and goes no further), after only a widget under it,
// offered the click first; presses aren't its, and it wants the pointer.
// Escape clears the selection, then leaves the entered link, then puts it
// down; putting it down puts down every tool picked up through an `edit: true`
// command (Measure), wherever it is in the stack, and the selection. It stays
// in hand across Enter and Leave.

import { EDIT_HAND } from "../stage/bodies.js";
import { restLayer } from "../stage/ladder.js";
import { keyOf } from "../stage/paths.js";

export default {
  create(api) {
    let release = null;
    const rest = () => {
      const v = api.view.get();
      return restLayer({ selection: v.selected != null, focus: v.focus?.length ?? 0 });
    };
    const input = {
      click(ev) {
        const path = ev?.hit?.path ?? null;
        // nothing to select or clear: the chain has it, the widget's owner first
        if (!path && api.view.get().selected == null) return false;
        if (api.offerWidget("click", ev)) return true;
        api.view.step({ type: "press", path: path ?? [] });
        return true;
      },
    };
    /** Is this held tool one picked up through an `edit: true` command? */
    function edits(held) {
      if (!held?.command) return false;
      for (const { id, value, stage } of api.collect("commands"))
        if (keyOf(stage, id) === held.ext && Array.isArray(value)) return value.some((c) => c?.id === held.command && c.edit === true);
      return false;
    }
    function put() {
      const r = release;
      release = null;
      r?.();
      for (const t of api.view.get().held ?? []) if (edits(t)) api.putDown(t);
      api.view.step({ type: "clear" });
    }
    /** Pick the editor up (true) or put it down. @returns whether it is held now */
    function hold(on) {
      if (!on) release?.();
      else
        release ??= api.hand({
          kind: "edit",
          name: EDIT_HAND,
          input,
          pointer: true,
          escape: () => {
            const l = rest();
            if (l) api.view.step({ type: "escape" });
            return l != null;
          },
          escaping: rest,
          put,
        });
      return !!release;
    }

    // arriving: the outermost doc's start says whether people start with the editor in hand (a scene made new is made to be built)
    let arrived = 0;
    const arrive = (v) => {
      if (!v.arrived || v.arrived.n === arrived) return;
      arrived = v.arrived.n;
      hold(v.arrived.start?.edit === true);
    };
    arrive(api.view.get());
    api.view.watch(arrive, (v) => v.arrived);

    return {
      commands: [
        {
          id: "edit",
          name: EDIT_HAND,
          // (the body chip's Edit runs it: no surface lists it)
          show: [],
          state: (target) => (target == null ? { checked: !!release, title: release ? "Put the editor down" : "Pick up the editor: select, move and change things" } : null),
          run: (_target, value) => hold(value === undefined ? !release : !!value),
        },
      ],
    };
  },
};
