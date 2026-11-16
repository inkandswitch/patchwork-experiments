import { describe, it, expect } from "vitest";
import { lockedNow, pointerStep } from "./pointer.js";

// H5's pure side (TOOLS.md §4): locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧
// ¬refused ∧ ¬touch, over all 2⁵ states, and every event on each.
const FIELDS = ["lock", "wanted", "released", "refused", "touch"];
const states = () => Array.from({ length: 1 << FIELDS.length }, (_, b) => Object.fromEntries(FIELDS.map((f, i) => [f, !!(b & (1 << i))])));
const EVENTS = [
  { type: "press" },
  { type: "key" },
  { type: "release" },
  { type: "refuse" },
  { type: "body", lock: true },
  { type: "body", lock: false },
  { type: "want", wanted: true },
  { type: "want", wanted: false },
  { type: "input", touch: true },
  { type: "input", touch: false },
];

describe("the pointer (H5), exhaustively", () => {
  it("locked is the formula, for every state", () => {
    let n = 0;
    for (const s of states()) {
      n++;
      expect(lockedNow(s)).toBe(s.lock && !s.wanted && !s.released && !s.refused && !s.touch);
    }
    expect(n).toBe(32);
  });

  it("every event on every state does only what it says", () => {
    let n = 0;
    for (const s of states()) {
      for (const ev of EVENTS) {
        n++;
        const { state: t, consumed } = pointerStep(s, ev);
        // the formula holds after every event: no field outside the five
        expect(Object.keys(t).sort()).toEqual([...FIELDS].sort());
        if (ev.type !== "press") expect(consumed).toBe(false);
        switch (ev.type) {
          case "press":
            // only a press after a release, on a body that locks, with nothing wanting the pointer and no finger,
            // relocks: and it is nothing else
            expect(consumed).toBe(s.released && s.lock && !s.wanted && !s.refused && !s.touch);
            expect(t).toEqual(consumed ? { ...s, released: false } : s);
            if (consumed) expect(lockedNow(t)).toBe(true);
            break;
          case "key":
            // a key never relocks, and never says what the input is
            expect(t).toEqual(s);
            break;
          case "release":
            // only a lock that was held can be released: under touch nothing was
            expect(t).toEqual(lockedNow(s) ? { ...s, released: true } : s);
            if (s.touch) expect(t).toEqual(s);
            expect(lockedNow(t)).toBe(false);
            break;
          case "refuse":
            expect(t).toEqual(s.lock ? { ...s, refused: true } : s);
            expect(lockedNow(t)).toBe(false);
            break;
          case "body":
            // a new body starts afresh; what the input is stays
            expect(t).toEqual({ ...s, lock: ev.lock, released: false, refused: false });
            break;
          case "want":
            expect(t).toEqual({ ...s, wanted: ev.wanted });
            break;
          case "input":
            // only what the input is: a finger never locks; a mouse locks by the formula
            expect(t).toEqual({ ...s, touch: ev.touch });
            if (ev.touch) expect(lockedNow(t)).toBe(false);
            else expect(lockedNow(t)).toBe(lockedNow({ ...s, touch: false }));
            break;
        }
      }
    }
    expect(n).toBe(32 * EVENTS.length);
  });
});
