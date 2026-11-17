import { describe, it, expect } from "vitest";
import { escapeHint, escapeLayer, restLayer } from "./ladder.js";

// H4 (STAGE.md, Invariants): Escape pops exactly the top of lock, field,
// gesture, the top hand (its own escape first: the Edit hand's is the view's
// rest), then the view's rest (selection, focus); never a body or the clock;
// the hint names it. Every state: lock, field, gesture and selection on or
// off × focus 0–2 × every hand stack of up to two of tool, popover and edit.
// A model presses Escape until nothing stands: every state ends, in exactly
// as many presses as layers (each hand one, the focus its depth).
const KINDS = ["tool", "popover", "edit"];
const stacks = [[], ...KINDS.map((k) => [k]), ...KINDS.flatMap((a) => KINDS.map((b) => [a, b]))];

// the state escapeLayer is given, as the router gathers it
const asked = (m) => {
  const top = m.hands.at(-1);
  return { lock: m.lock, field: m.field, gesture: m.gesture, hand: top ? { kind: top, escaping: top === "edit" ? restLayer(m) : null } : null, rest: restLayer(m), body: m.body, clock: m.clock };
};
// one Escape, as the router does what the layer says
function press(m) {
  const layer = escapeLayer(asked(m));
  if (layer === "selection") return { ...m, selection: false };
  if (layer === "focus") return { ...m, focus: m.focus - 1 };
  if (layer === "hand" || layer === "popover") return { ...m, hands: m.hands.slice(0, -1) };
  if (layer) return { ...m, [layer]: false };
  return m;
}

describe("Escape (H4), exhaustively", () => {
  it("pops exactly the top layer standing, never a body or the clock; the hint names it; every state ends in as many presses as it has layers", () => {
    let n = 0;
    for (let bits = 0; bits < 16; bits++)
      for (let focus = 0; focus <= 2; focus++)
        for (const hands of stacks) {
          const m = { lock: !!(bits & 1), field: !!(bits & 2), gesture: !!(bits & 4), selection: !!(bits & 8), focus, hands, body: "walk", clock: { running: true } };
          const top = hands.at(-1);
          const want = m.lock ? "lock" : m.field ? "field" : m.gesture ? "gesture" : top === "tool" ? "hand" : top === "popover" ? "popover" : m.selection ? "selection" : focus ? "focus" : top === "edit" ? "hand" : null;
          expect([m, escapeLayer(asked(m))]).toEqual([m, want]);
          expect(escapeHint(want) === "").toBe(want === null);
          let t = m;
          let presses = 0;
          while (escapeLayer(asked(t))) {
            const next = press(t);
            expect(next.body).toBe(m.body);
            expect(next.clock).toBe(m.clock);
            t = next;
            presses++;
          }
          expect(presses).toBe([m.lock, m.field, m.gesture, m.selection].filter(Boolean).length + hands.length + focus);
          n++;
        }
    expect(n).toBe(16 * 3 * stacks.length);
  });

  it("names the hand in its hint", () => {
    expect(escapeHint("hand", { hand: "Measure" })).toBe("put down Measure");
    expect(escapeHint("hand", { hand: "Edit" })).toBe("put down Edit");
    expect(escapeHint("lock")).toBe("release pointer");
    expect(escapeHint("selection")).toBe("deselect");
  });
});
