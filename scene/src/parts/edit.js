// scene.edit: the Edit hand, the editor's (STAGE.md, "Hands"; HISTORY.md,
// Kernel steps 1 and 2).
//
// The viewer picks the editor up or puts it down (the body chip's Edit runs
// this plugin's `edit` command; `view.start.edit` picks it up on arriving).
// It is an ordinary hand (api.hand), so the view knows nothing of editing
// beyond which hands are held: editing(view) is "a hand of kind edit is
// held" (../stage/bodies.js). While held:
// - a click selects at the focus (the selection step "press": on nothing it
//   clears, outside the focus it selects nothing), after only a widget under
//   it (the halo's handles and knobs: offered the click first, once; if its
//   owner passes, the click is still the editor's). Presses are not its:
//   carries and drags go down the chain. It wants the pointer free, so
//   walking while editing looks by drag;
// - Escape clears the selection, then leaves the entered link, and when
//   there is neither the hand is put down;
// - putting it down puts down a tool picked up through an `edit: true`
//   command (Measure) and the selection (attention is the selection, so one
//   kept from editing would aim F and the use prompt at what was last
//   edited). The focus stays: it is where the viewer is.
// A view plugin doesn't move with the focus, so the editor stays in hand
// across Enter and Leave.

import { EDIT_HAND } from "../stage/bodies.js";
import { restLayer } from "../stage/ladder.js";
import { keyOf } from "../stage/paths.js";

export default {
  create(api) {
    let release = null;
    // what Escape does with the editor in hand: clear the selection, else leave the entered link, else nothing
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
        // A click on something is the editor's wherever it lands: outside the focus it selects nothing
        // and goes no further, so no package's click verb acts for an Edit click. Presses, keys, the
        // menu and the prompt still reach outside the focus.
        api.view.step({ type: "press", path: path ?? [] });
        return true;
      },
    };
    /** Is the held tool one picked up through an `edit: true` command? */
    function heldEdits() {
      const held = api.view.get().held;
      if (!held?.command) return false;
      for (const { id, value, stage } of api.collect("commands"))
        if (keyOf(stage, id) === held.ext && Array.isArray(value)) return value.some((c) => c?.id === held.command && c.edit === true);
      return false;
    }
    function put() {
      const r = release;
      release = null;
      r?.();
      if (heldEdits()) api.putDown();
      api.view.step({ type: "clear" });
    }
    /** Pick the editor up (true) or put it down. @returns whether it is held now */
    function hold(on) {
      if (!on) {
        release?.();
        return false;
      }
      if (release) return true;
      release = api.hand({
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
      return true;
    }

    // arriving: the outermost doc's start says whether people start with the editor in hand (a scene made new is made to be built)
    let arrived = 0;
    const arrive = (v) => {
      const a = v.arrived;
      if (!a || a.n === arrived) return;
      arrived = a.n;
      hold(a.start?.edit === true);
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
