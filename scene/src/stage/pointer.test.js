import { describe, it, expect } from "vitest";
import { lockedNow, looksFromEye, pointerStep } from "./pointer.js";

// H5's pure side (STAGE.md, "Bodies"): locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧
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

  it("the look is the eye's under lock, and for a lock body under touch (no hover to look with), for every state", () => {
    let n = 0;
    for (const s of states()) {
      n++;
      const p = { ...s, locked: lockedNow(s) };
      expect([s, looksFromEye(p)]).toEqual([s, p.locked || (s.lock && !s.wanted && s.touch)]);
      // a mouse that isn't locked (released, refused, or something wants the pointer) looks where it hovers;
      // a finger hovers nowhere, so wherever the body would lock, its eye looks
      if (s.lock && !s.wanted) expect(looksFromEye(p)).toBe(s.touch || (!s.released && !s.refused));
      else expect(looksFromEye(p)).toBe(false);
    }
    expect(n).toBe(32);
    expect(looksFromEye(null)).toBe(false);
  });

  it("every event on every state does only what it says", () => {
    let n = 0;
    for (const s of states()) {
      for (const ev of EVENTS) {
        n++;
        const { state: t, consumed } = pointerStep(s, ev);
        // no field outside the five
        expect(Object.keys(t).sort()).toEqual([...FIELDS].sort());
        if (ev.type !== "press") expect(consumed).toBe(false);
        // what may take the lock: a press on the world that is then nothing else, a new body, or the pointer no
        // longer wanted (both chosen in the view: a menu, a key); never a key, a release, a refusal or an input
        if (!lockedNow(s) && lockedNow(t)) expect(consumed || ev.type === "body" || (ev.type === "want" && !ev.wanted)).toBe(true);
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
            if (ev.touch === s.touch) {
              // the same input again: nothing
              expect(t).toBe(s);
            } else if (ev.touch) {
              // a finger: no lock, and none to take back
              expect(t).toEqual({ ...s, touch: true, released: false });
            } else {
              // a mouse after a finger: what it would lock waits for a press on the world, which only relocks
              const waits = s.lock && !s.wanted && !s.refused;
              expect(t).toEqual({ ...s, touch: false, released: s.released || waits });
              expect(pointerStep(t, { type: "press" }).consumed).toBe(waits);
            }
            // an input never locks: the lock is only ever taken by a press on the world that is nothing else
            if (!lockedNow(s)) expect(lockedNow(t)).toBe(false);
            if (ev.touch) expect(lockedNow(t)).toBe(false);
            break;
        }
      }
    }
    expect(n).toBe(32 * EVENTS.length);
  });
});
