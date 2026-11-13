// The selection lives at the focus (TOOLS.md §3, invariant H10). Pure.
//
// A path names something through the stages it is inside: the links from
// the outermost stage in, then the thing itself ([] is nothing). The focus
// is the path of the links entered ([] is the scene itself). The selection
// is null, or a path one longer than the focus that starts with it: an
// element of the focus stage. So with the focus on the boat, selecting a
// card aboard selects the link it's in; outside the focus a Select does
// nothing (verbs and carries still reach there: they don't go through here).
//
// Until links are open (COMPOSITION.md build step 12) there is one stage and
// the focus is always []: a selection is [id]. The stage keeps it as
// local.selected = id.

/** The element of the focus stage that `path` goes through, or null when it's outside the focus (or nothing). */
export function atFocus(focus, path) {
  if (!Array.isArray(path) || path.length <= focus.length) return null;
  for (let i = 0; i < focus.length; i++) if (path[i] !== focus[i]) return null;
  return path.slice(0, focus.length + 1);
}

/** Is `selected` an element of the focus stage (or null)? H10. */
export const selectionAtFocus = ({ focus, selected }) => selected == null || (selected.length === focus.length + 1 && atFocus(focus, selected) != null);

/**
 * The selection and focus after one event:
 * - press { path }: the orbit view's plain click. On something in the focus
 *   it selects that element; on nothing ([]) it clears; outside, nothing.
 * - select { path }: the menu's Select: as a press, but on nothing, nothing.
 * - enter { path }: enter a link that is an element of the focus stage; the
 *   selection clears (it was in the stage left behind).
 * - leave: out to the stage the focus is in, selection cleared; at the
 *   scene itself, nothing.
 * - escape: the selection if there is one, else the focus (Leave).
 * @param {{ focus: string[], selected: string[] | null }} state
 * @param {{ type: "press" | "select" | "enter" | "leave" | "escape", path?: string[], link?: boolean }} ev
 * @returns {{ focus: string[], selected: string[] | null }} the same object when nothing changes
 */
export function selectionStep(state, ev) {
  const { focus, selected } = state;
  switch (ev?.type) {
    case "press":
    case "select": {
      if (ev.type === "press" && !ev.path?.length) return selected == null ? state : { focus, selected: null };
      const at = atFocus(focus, ev.path);
      if (!at || (selected && sameKey(selected, at))) return state;
      return { focus, selected: at };
    }
    case "enter": {
      const at = atFocus(focus, ev.path);
      if (!at || !ev.link || at.length !== ev.path.length) return state;
      return { focus: at, selected: null };
    }
    case "leave":
      return focus.length ? { focus: focus.slice(0, -1), selected: null } : state;
    case "escape":
      if (selected != null) return { focus, selected: null };
      return focus.length ? { focus: focus.slice(0, -1), selected: null } : state;
    default:
      return state;
  }
}

const sameKey = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
