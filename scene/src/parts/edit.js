// scene.edit: the Edit hand, the editor's (EDITOR.md, "The Edit hand"). An
// ordinary hand of kind EDIT (./editing.js): the editor's commands name it
// (`hand: "edit"`), so they apply exactly while it is held, and a tool picked
// up through one goes down with it (STAGE.md, "Commands"). The body chip's
// Edit runs its `edit` command, and the outermost doc's `view.start.edit`
// picks it up on arriving. While held, a click selects at the focus (on
// nothing it clears, outside the focus it selects nothing and goes no
// further), after only a widget under it, offered the click first; presses
// aren't its, and it wants the pointer. Escape clears the selection, then
// leaves the entered link, then puts it down; putting it down clears the
// selection. It stays in hand across Enter and Leave. A second click on the
// same thing within DOUBLE_MS and DOUBLE_PX of the first Opens the selection
// (./open.js): in Edit only, so a game's clicks stay clicks (PLANS.md §5).
// (Enter is the Open commands' own key, so the key map shows and resolves
// it.) Its Select, on the bar beside Move, puts the editor's tools down.

import { restLayer } from "../stage/ladder.js";
import { EDIT, EDIT_HAND } from "./editing.js";
import { runOpen } from "./open.js";

/** A double-click: the second click within this long (stage ms) and this near (px) of the first, on the same thing. */
export const DOUBLE_MS = 500;
export const DOUBLE_PX = 6;

export default {
  create(api) {
    let release = null;
    const rest = () => {
      const v = api.view.get();
      return restLayer({ selection: v.selected != null, focus: v.focus?.length ?? 0 });
    };
    /** The last click that selected something: { key, at, x, y }, to tell a double-click. */
    let last = null;
    /** Open what's selected at the focus (./open.js). */
    const openSelected = () => runOpen(api, api.focus()?.view.get().selected ?? null);
    const input = {
      click(ev) {
        const path = ev?.hit?.path ?? null;
        // nothing to select or clear: the chain has it, the widget's owner first
        if (!path && api.view.get().selected == null) return false;
        if (api.offerWidget("click", ev)) return (last = null), true;
        api.view.step({ type: "press", path: path ?? [] });
        const key = path ? JSON.stringify(path) : null;
        const now = api.now();
        const double = key != null && last?.key === key && now - last.at <= DOUBLE_MS && Math.hypot(ev.x - last.x, ev.y - last.y) <= DOUBLE_PX;
        last = key && !double ? { key, at: now, x: ev.x, y: ev.y } : null;
        if (double) openSelected();
        return true;
      },
    };
    /** The held tools picked up through the editor's commands (each says the hand it was held for). */
    const tools = () => (api.view.get().held ?? []).filter((t) => t.hand === EDIT);
    function put() {
      const r = release;
      release = null;
      r?.();
      api.view.step({ type: "clear" });
    }
    /** Pick the editor up (true) or put it down. @returns whether it is held now */
    function hold(on) {
      if (!on) release?.();
      else
        release ??= api.hand({
          kind: EDIT,
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
        {
          // Select (PLANS.md §5): the editor's resting tool, beside Move on the bar: picking it
          // puts down every tool picked up through the editor's commands; it's checked while none is held
          id: "select-tool",
          name: "Select",
          group: "tools",
          // first of the tools, whatever runs before the editor
          order: -1,
          icon: "select",
          hand: EDIT,
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: !tools().length, title: "Select: a click selects (puts the other tools down)" } : null),
          run: () => {
            for (const t of tools()) api.putDown(t);
          },
        },
      ],
    };
  },
};
