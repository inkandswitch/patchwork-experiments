import { describe, it, expect } from "vitest";
import { MODAL, handOf, popoverSpec, refuses, toolSpec, wantsPointer, whichTool, withHand, withoutHand } from "./hands.js";

// The hand stack's rules (STAGE.md, "Hands"; H4, H12, H14), over every stack
// reachable from nothing by picking up, putting down and Escape, × every one
// of those steps: so every sequence of any length. The hands: two of the
// editor's kind (E, F), one of a plugin's (K), a popover (P), a tool (M), a
// tool held for "edit" (T) and one for "pad" (U), which is no kind anyone
// holds, and one for "tool" (R), a kind of the kernel's.
const H = {
  E: { kind: "edit", pointer: true },
  F: { kind: "edit" },
  K: { kind: "seat" },
  P: popoverSpec(() => {}),
  M: { kind: "tool", command: "m", pointer: true },
  T: { kind: "tool", command: "t", handKind: "edit" },
  U: { kind: "tool", command: "u", handKind: "pad" },
  R: { kind: "tool", command: "r", handKind: "tool" },
};
const NAMES = Object.keys(H);
const hand = Object.fromEntries(NAMES.map((k, i) => [k, handOf(k, H[k], i + 1, H[k].handKind ?? null)]));
const names = (hs) => hs.map((h) => h.owner).join("");
const kindHeld = (hs, kind) => hs.some((h) => h.kind === kind);

/** One step on a stack: the change it makes (null: nothing changes), as the router asks for it. */
function step(hs, st) {
  if (st === "esc") return hs.length ? withoutHand(hs, hs.at(-1)) : null;
  const h = hand[st.slice(1)];
  if (st[0] === "-") return withoutHand(hs, h);
  if (hs.includes(h) || refuses(hs, h.handKind)) return null;
  return withHand(hs, h);
}
const STEPS = ["esc", ...NAMES.flatMap((k) => [`+${k}`, `-${k}`])];

describe("the hand stack (H4, H12, H14), over every reachable stack × every step", () => {
  it("a hand picked up goes on top and puts none down; one leaving takes exactly the tools held for its kind if it was the last of it, told after them; refusals; nothing told twice", () => {
    const seen = new Map([["", []]]);
    const queue = [[]];
    let n = 0;
    while (queue.length) {
      const hs = queue.shift();
      // H14 holds in every reachable stack: a tool held for a kind is held only while a hand of that kind is
      for (const h of hs) if (h.handKind != null) expect([names(hs), h.owner, kindHeld(hs, h.handKind)]).toEqual([names(hs), h.owner, true]);
      for (const st of STEPS) {
        const c = step(hs, st);
        n++;
        const label = `${names(hs)} ${st}`;
        const x = st === "esc" ? hs.at(-1) : hand[st.slice(1)];
        if (st[0] === "+") {
          const refused = !!x.handKind && (x.handKind === "tool" || x.handKind === "popover" || !kindHeld(hs, x.handKind));
          expect([label, refuses(hs, x.handKind)]).toEqual([label, refused]);
          // H12: on top, nothing put down, nobody told
          if (c) expect([label, names(c.hands), c.off, c.tell]).toEqual([label, names(hs) + x.owner, [], []]);
          else expect([label, hs.includes(x) || refused]).toEqual([label, true]);
        } else if (!x || !hs.includes(x)) {
          expect([label, c]).toEqual([label, null]);
        } else {
          // what is left keeps its order; what left is told once each, the hand itself last (H4: Escape's is the top)
          const left = c.hands;
          expect([label, names(hs.filter((h) => left.includes(h)))]).toEqual([label, names(left)]);
          const gone = hs.filter((h) => !left.includes(h));
          expect([label, new Set(c.off).size, c.off.length, new Set(c.off)]).toEqual([label, gone.length, gone.length, new Set(gone)]);
          const told = c.tell.map((t) => t.to);
          expect([label, c.off[0], told.length, new Set(told), told.at(-1), c.tell.every((t) => t.what === "put" && t.owner === t.to.owner)]).toEqual([label, x, gone.length, new Set(gone), x, true]);
          // exactly the tools whose kind went with x left with it: none more (each lost the last of its kind), none fewer (H14)
          for (const g of gone) if (g !== x) expect([label, g.owner, g.handKind != null && !kindHeld(left, g.handKind)]).toEqual([label, g.owner, true]);
          for (const h of left) if (h.handKind != null) expect([label, h.owner, kindHeld(left, h.handKind)]).toEqual([label, h.owner, true]);
          // a tool that left because its kind went is told before the last hand of that kind that went
          for (const g of gone) if (g !== x) expect([label, g.owner, told.indexOf(g) < Math.max(...gone.filter((h) => h.kind === g.handKind).map((h) => told.indexOf(h)))]).toEqual([label, g.owner, true]);
        }
        if (c && !seen.has(names(c.hands))) {
          seen.set(names(c.hands), c.hands);
          queue.push(c.hands);
        }
      }
    }
    // R (a kernel kind) and U (a kind nobody holds) are never held
    expect([...seen.keys()].some((k) => k.includes("R") || k.includes("U"))).toBe(false);
    expect([seen.size, n]).toEqual([seen.size, seen.size * STEPS.length]);
    expect(seen.size).toBeGreaterThan(1000);
  });

  it("what a stack says: the held tool named (serial, else owner and command, else the topmost) and whether a hand wants the pointer", () => {
    const hs = [hand.E, hand.M, hand.T, hand.K];
    expect([whichTool(hs), whichTool(hs, { serial: hand.M.serial }), whichTool(hs, { owner: "T", command: "t" }), whichTool(hs, { owner: "T", command: "m" }), whichTool([hand.E])]).toEqual([hand.T, hand.M, hand.T, null, null]);
    expect([wantsPointer(hs), wantsPointer([hand.F, hand.K, hand.T]), wantsPointer([])]).toEqual([true, false, false]);
  });

  it("a popover takes every event and Escape closes it, asking to be put down; a tool's put() is its input's", () => {
    let closed = 0;
    const p = popoverSpec(() => closed++);
    expect([p.kind, p.pointer, p.input, ...["press", "click", "menu", "wheel"].map((t) => !!MODAL[t]())]).toEqual(["popover", true, MODAL, true, true, true, true]);
    expect([p.escape(), closed]).toEqual([false, 1]);
    let put = 0;
    toolSpec({ command: "c", name: "C", input: { put: () => put++ } }).put();
    toolSpec({ command: "c", name: "C", input: {} }).put();
    expect(put).toBe(1);
  });
});
