import { describe, it, expect } from "vitest";
import { lockedNow, pointerStep } from "./pointer.js";

// H5's pure side (TOOLS.md §4): locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧
// ¬refused, over all 2⁴ states, and every event on each.
const states = () => Array.from({ length: 16 }, (_, b) => ({ lock: !!(b & 1), wanted: !!(b & 2), released: !!(b & 4), refused: !!(b & 8) }));
const EVENTS = [{ type: "press" }, { type: "key" }, { type: "release" }, { type: "refuse" }, { type: "body", lock: true }, { type: "body", lock: false }, { type: "want", wanted: true }, { type: "want", wanted: false }];

describe("the pointer (H5), exhaustively", () => {
  it("locked is the formula, for every state", () => {
    for (const s of states()) expect(lockedNow(s)).toBe(s.lock && !s.wanted && !s.released && !s.refused);
  });

  it("every event on every state does only what it says", () => {
    let n = 0;
    for (const s of states()) {
      for (const ev of EVENTS) {
        n++;
        const { state: t, consumed } = pointerStep(s, ev);
        switch (ev.type) {
          case "press":
            // only a press after a release, on a body that locks, with nothing wanting the pointer, relocks: and it is nothing else
            expect(consumed).toBe(s.released && s.lock && !s.wanted && !s.refused);
            expect(t).toEqual(consumed ? { ...s, released: false } : s);
            if (consumed) expect(lockedNow(t)).toBe(true);
            break;
          case "key":
            // a key never relocks
            expect(consumed).toBe(false);
            expect(t).toEqual(s);
            break;
          case "release":
            // only a lock that was held can be released
            expect(t).toEqual(lockedNow(s) ? { ...s, released: true } : s);
            expect(lockedNow(t)).toBe(false);
            break;
          case "refuse":
            expect(t).toEqual(s.lock ? { ...s, refused: true } : s);
            expect(lockedNow(t)).toBe(false);
            break;
          case "body":
            // a new body starts afresh
            expect(t).toEqual({ ...s, lock: ev.lock, released: false, refused: false });
            break;
          case "want":
            expect(t).toEqual({ ...s, wanted: ev.wanted });
            break;
        }
      }
    }
    expect(n).toBe(16 * EVENTS.length);
  });
});
