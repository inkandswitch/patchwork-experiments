import { describe, it, expect } from "vitest";
import { RUNGS, escapeHint, escapeLayer, escapeStep } from "./ladder.js";

// H4 (STAGE.md, Invariants): Escape pops exactly the top of lock, field,
// popover, gesture, tool, selection, focus; never the body or the clock; the
// hint names it. Every state: the six layers on or off × focus depth 0–3,
// with a body and a clock that must come through untouched.
const FLAGS = ["lock", "field", "popover", "gesture", "tool", "selection"];

function* states() {
  for (let bits = 0; bits < 1 << FLAGS.length; bits++) {
    for (let focus = 0; focus <= 3; focus++) {
      const s = { focus, body: "walk", clock: { running: true } };
      FLAGS.forEach((f, i) => (s[f] = !!(bits & (1 << i))));
      yield s;
    }
  }
}

describe("the Escape ladder (H4), exhaustively", () => {
  it("pops exactly the top layer standing, never the body or the clock, and the hint names it", () => {
    let n = 0;
    for (const s of states()) {
      n++;
      const standing = RUNGS.filter((r) => (r === "focus" ? s.focus > 0 : s[r]));
      const top = standing[0] ?? null;
      expect(escapeLayer(s)).toBe(top);
      const next = escapeStep(s);
      // the body and the clock never move
      expect(next.body).toBe(s.body);
      expect(next.clock).toBe(s.clock);
      // exactly one layer popped: the top; every other the same
      for (const f of FLAGS) expect(next[f]).toBe(f === top ? false : s[f]);
      expect(next.focus).toBe(top === "focus" ? s.focus - 1 : s.focus);
      // the hint names the layer (and nothing when none stands)
      expect(escapeHint(top) === "").toBe(top === null);
      // pressing until nothing stands takes exactly as many presses as layers (focus counting its depth)
      let t = s;
      let presses = 0;
      while (escapeLayer(t)) {
        t = escapeStep(t);
        presses++;
      }
      expect(presses).toBe(standing.filter((r) => r !== "focus").length + s.focus);
    }
    expect(n).toBe(64 * 4);
  });

  it("names the held tool in its hint", () => {
    expect(escapeHint("tool", { tool: "Measure" })).toBe("put down Measure");
    expect(escapeHint("lock")).toBe("release pointer");
    expect(escapeHint("selection")).toBe("deselect");
  });
});
