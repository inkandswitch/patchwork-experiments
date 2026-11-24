import { describe, it, expect } from "vitest";
import { baseOnly, ownedBody, settleTop, topBody, withBody, withoutBody } from "./body-stack.js";

// The body stack's rules (STAGE.md, "Bodies"), over every sequence of up to
// five steps: entering A, B or R; Leave (the top); entering Look (every body
// over the base leaves); and an extension stopping (A's first body and
// everything over it). R enters S from its own leave(), as a body that hands
// you to another on the way out may: a change made while one is under way.
// Each change is applied as the router applies it (router.js restack): the
// stack kept first, then the tells, then the top's turn. Against a model:
// the stack; each body told `left` once, as it leaves, and nothing after;
// `suspended` and `resumed` in turn, starting live; once quiet, the top live
// and every body under it suspended; the keys let go of exactly what was told
// `left` or `suspended`; the base never leaves.
const STEPS = ["A", "B", "R", "leave", "look", "stop A"];

function* sequences(n) {
  if (n === 0) return yield [];
  for (const s of sequences(n - 1)) for (const st of STEPS) yield [...s, st];
}

function run(seq) {
  const told = new Map(); // body → what it was told, in order
  const keysOff = [];
  let made = 0;
  const body = (id, owner = id.toLowerCase()) => {
    const b = { owner, id, lock: false, keys: [], serial: made++, input: {} };
    for (const what of ["left", "suspended", "resumed"])
      b.input[what] = () => {
        told.get(b).push(what);
        if (id === "R" && what === "left") apply(withBody(s, body("S")));
      };
    told.set(b, []);
    return b;
  };
  let s = baseOnly(body("look", null));
  const base = s.stack[0];
  function apply(c) {
    if (!c) return;
    s = c.bodies;
    const tells = new Set(c.tell.filter((t) => t.what !== "resumed").map((t) => t.to));
    keysOff.push([new Set(c.off.map((b) => b.input)), tells]);
    for (const t of c.tell) t.to[t.what]();
    apply(settleTop(s));
  }
  // the model: ids bottom first
  let m = ["look"];
  for (const st of seq) {
    const before = s.stack;
    if (st === "leave") apply(withoutBody(s, topBody(s)));
    else if (st === "look") apply(s.stack.length > 1 ? withoutBody(s, s.stack[1]) : null);
    else if (st === "stop A") apply(withoutBody(s, ownedBody(s, "a")));
    else apply(withBody(s, body(st)));
    // the model's step: what leaves is a suffix; each R leaving brings an S on top
    const cut = st === "leave" ? Math.max(1, m.length - 1) : st === "look" ? 1 : st === "stop A" ? (m.indexOf("A") > 0 ? m.indexOf("A") : m.length) : m.length;
    const gone = before.slice(cut);
    m = [...m.slice(0, cut), ...(st.length === 1 ? [st] : []), ...gone.filter((b) => b.id === "R").map(() => "S")];
  }
  return { s, m, told, base, keysOff };
}

describe("the body stack, every sequence of ≤5 steps", () => {
  it("the stack is the model's; every body is told left once and nothing after, suspended and resumed in turn; quiet, the top lives and the rest are suspended; keys go with exactly what left or went under", () => {
    let n = 0;
    for (let len = 0; len <= 5; len++)
      for (const seq of sequences(len)) {
        const { s, m, told, base, keysOff } = run(seq);
        expect([seq, s.stack.map((b) => b.id)]).toEqual([seq, m]);
        expect([seq, s.stack[0], s.live]).toEqual([seq, base, topBody(s)]);
        for (const [b, t] of told) {
          const said = t.join(" ");
          // starting live: (suspended resumed)*, then suspended if it is under the top, then left if it went
          expect([seq, b.id, /^(suspended resumed ?)*(suspended ?)?(left)?$/.test(said)]).toEqual([seq, b.id, true]);
          const on = s.stack.includes(b);
          expect([seq, b.id, t.includes("left")]).toEqual([seq, b.id, !on]);
          if (on) expect([seq, b.id, t.at(-1) === "suspended"]).toEqual([seq, b.id, b !== topBody(s)]);
        }
        expect(told.get(base).includes("left")).toBe(false);
        for (const [off, tells] of keysOff) expect([seq, off]).toEqual([seq, tells]);
        n++;
      }
    expect(n).toBe([0, 1, 2, 3, 4, 5].reduce((a, k) => a + STEPS.length ** k, 0));
  });
});
