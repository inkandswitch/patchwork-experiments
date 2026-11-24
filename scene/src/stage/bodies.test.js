// @vitest-environment happy-dom
// Look and the hands (./bodies.js, STAGE.md, "Bodies", "Hands"): the body
// stack and whether a hand of a kind is held, as the stage keeps them, against
// a model, over every sequence of entering, leaving, picking up and putting
// down. Finite and exhaustive: no randomness.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { holding, pointing } from "./bodies.js";
import { mountStage } from "../test/stage-harness.js";

// What can happen: entering each body (the stage's Look; three of a plugin's),
// Leave, and picking up or putting down a hand.
const EVENTS = ["look", "walk", "seat", "station", "leave", "pick", "put"];
// the model, STAGE.md's rule: entering Look leaves every body, any other goes on top; Leave pops the top, never Look
const enterStep = (stack, id) => (id === "look" ? ["look"] : [...stack, id]);
const leaveStep = (stack) => (stack.length > 1 ? stack.slice(0, -1) : stack);
// [bodies, holding]
const apply = ([stack, h], ev) => (ev === "leave" ? [leaveStep(stack), h] : ev === "pick" ? [stack, true] : ev === "put" ? [stack, false] : [enterStep(stack, ev), h]);

/** Every sequence of up to `n` events. */
function* sequences(n) {
  yield [];
  if (n === 0) return;
  for (const s of sequences(n - 1)) if (s.length === n - 1) for (const e of EVENTS) yield [...s, e];
}
const all = (n) => {
  const out = [];
  for (let k = 0; k <= n; k++) for (const s of sequences(k)) if (s.length === k) out.push(s);
  return out;
};

describe("what reads the hands", () => {
  it("what reads them", () => {
    const views = [{ hands: [{ kind: "tool" }, { kind: "k" }] }, { hands: [{ kind: "tool" }] }, { hands: [] }, { body: { id: "k" } }, {}, null];
    expect(views.map((v) => holding(v, "k"))).toEqual([true, false, false, false, false, false]);
    expect(views.map((v) => holding(v, "tool"))).toEqual([true, true, false, false, false, false]);
    const held = { held: [{ ext: "a", pointer: true }, { ext: "b", pointer: false }] };
    expect([pointing(held), pointing(held, "a"), pointing(held, "b"), pointing({ held: [] }), pointing(null)]).toEqual([true, false, true, false, false]);
  });
});

// On the stage itself: every sequence of up to 4 events, without a hand and
// holding one. After each, the stage's body, depth and hands are
// the model's. Entering, leaving and the hands are synchronous, so no
// waiting between events.
describe("bodies: the stage keeps the model", () => {
  let s = null;
  afterEach(() => {
    s?.unmount();
    s = null;
  });
  const BODIES = {
    meta: { id: "t.bodies" },
    module: {
      create: () => ({
        bodies: ["walk", "seat", "station"].map((id) => ({ id, label: id, reach: 2, enter: () => ({ input: {}, leave() {} }) })),
      }),
    },
  };
  const HAND = { meta: { id: "t.hand", type: "scene:view" }, module: { create: () => ({}) } };

  it("every sequence of ≤4 events, from Look without a hand and holding one", async () => {
    let n = 0;
    s = await mountStage({ extensions: [BODIES, HAND], editor: false, natives: false });
    const api = s.api("t.bodies");
    const view = s.api("t.hand");
    let release = null;
    const hold = (on) => {
      if (on) release ??= view.hand({ kind: "k", name: "K" });
      else release = (release?.(), null);
      return holding(s.local.get(), "k");
    };
    for (const start of [false, true]) {
      for (const seq of all(4)) {
        // back to the start, nothing standing
        api.body.enter("look");
        hold(start);
        let m = [["look"], start];
        for (const ev of seq) {
          if (ev === "leave") expect(api.body.leave()).toBe(m[0].length > 1);
          else if (ev === "pick" || ev === "put") expect(hold(ev === "pick")).toBe(ev === "pick");
          else expect(api.body.enter(ev)).toBe(true);
          m = apply(m, ev);
          const b = s.local.get().body;
          expect([seq, ev, b.id, b.depth, holding(s.local.get(), "k")]).toEqual([seq, ev, m[0].at(-1), m[0].length - 1, m[1]]);
          expect(s.debug.router.bodies().map((x) => x.id)).toEqual(m[0]);
          expect(s.local.get().hands.map((h) => h.name)).toEqual(m[1] ? ["K"] : []);
        }
        n++;
      }
    }
    expect(n).toBe(2 * (1 + 7 + 49 + 343 + 2401));
  }, 60_000);
});
