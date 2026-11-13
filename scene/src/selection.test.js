import { describe, it, expect } from "vitest";
import { atFocus, selectionAtFocus, selectionStep } from "./selection.js";

// A tree two wide and three deep: every path names something through the
// links it is inside. A path with something inside it is a link.
const PATHS = [];
for (const a of ["a", "b"]) {
  PATHS.push([a]);
  for (const b of ["c", "d"]) {
    PATHS.push([a, b]);
    for (const c of ["e", "f"]) PATHS.push([a, b, c]);
  }
}
const isLink = (p) => p.length < 3;
const EVENTS = [
  { type: "press", path: [] },
  ...PATHS.map((path) => ({ type: "press", path })),
  ...PATHS.map((path) => ({ type: "select", path })),
  ...PATHS.map((path) => ({ type: "enter", path, link: isLink(path) })),
  { type: "leave" },
  { type: "escape" },
];
const START = Object.freeze({ focus: Object.freeze([]), selected: null });
const key = (st) => JSON.stringify(st);

describe("H10: the selection is at the focus", () => {
  it("over every sequence of up to three events, from the scene itself", () => {
    let seqs = 0;
    const walk = (st, depth) => {
      expect(selectionAtFocus(st)).toBe(true);
      seqs++;
      if (depth === 3) return;
      for (const ev of EVENTS) walk(selectionStep(st, ev), depth + 1);
    };
    walk(START, 0);
    const n = EVENTS.length;
    expect(seqs).toBe(1 + n + n * n + n * n * n);
  });

  // every state the model can be in: a focus on a link, a selection at it or none
  const STATES = [START, ...PATHS.filter(isLink).map((focus) => ({ focus, selected: null }))].flatMap((st) => [
    st,
    ...PATHS.filter((p) => p.length === st.focus.length + 1 && atFocus(st.focus, p)).map((selected) => ({ focus: st.focus, selected })),
  ]);

  it("each event from each state does what it says", () => {
    for (const st of STATES)
      for (const ev of EVENTS) {
        const next = selectionStep(st, ev);
        const at = ev.path ? atFocus(st.focus, ev.path) : null;
        let want;
        if (ev.type === "press" && !ev.path.length) want = { focus: st.focus, selected: null };
        else if (ev.type === "press" || ev.type === "select") want = at ? { focus: st.focus, selected: at } : st; // outside the focus: nothing
        else if (ev.type === "enter") want = at && ev.link && at.length === ev.path.length ? { focus: at, selected: null } : st;
        else if (ev.type === "leave") want = st.focus.length ? { focus: st.focus.slice(0, -1), selected: null } : st;
        else want = st.selected ? { focus: st.focus, selected: null } : st.focus.length ? { focus: st.focus.slice(0, -1), selected: null } : st;
        expect([key(st), key(ev), key(next)]).toEqual([key(st), key(ev), key(want)]);
        // nothing changed: the same object, so a caller can tell
        if (key(next) === key(st)) expect(next).toBe(st);
      }
  });

  it("with the focus on a link, selecting something deep inside it selects the element of the focus stage it's in", () => {
    const st = { focus: ["a"], selected: null };
    expect(selectionStep(st, { type: "select", path: ["a", "c", "e"] }).selected).toEqual(["a", "c"]);
    expect(selectionStep(st, { type: "select", path: ["b", "c"] })).toBe(st);
    expect(selectionStep(st, { type: "select", path: ["a"] })).toBe(st); // the focus itself is no element of it
  });
});
