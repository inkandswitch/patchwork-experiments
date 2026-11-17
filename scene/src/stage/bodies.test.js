// Look and the Edit hand (./bodies.js, STAGE.md, "Bodies", "Hands"): the body
// stack and whether the editor is held, as a model and as the stage keeps
// them, over every sequence of entering, leaving, picking up and putting
// down. Finite and exhaustive: no randomness.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { editing, enterStep, inBody, leaveStep } from "./bodies.js";
import { mountStage } from "../test/stage-harness.js";

// What can happen: entering each body (the stage's Look; walk, seat and
// station, a package's), Leave, and picking up or putting down the editor.
const EVENTS = ["look", "walk", "seat", "station", "leave", "edit", "unedit"];
// the model: [bodies, editing]
const apply = ([stack, ed], ev) => (ev === "leave" ? [leaveStep(stack), ed] : ev === "edit" ? [stack, true] : ev === "unedit" ? [stack, false] : [enterStep(stack, ev), ed]);

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

describe("bodies: the model", () => {
  it("what reads them", () => {
    const edit = { hands: [{ kind: "tool" }, { kind: "edit" }] };
    expect([edit, { hands: [{ kind: "tool" }] }, { hands: [] }, { body: { id: "edit" } }, {}, null].map(editing)).toEqual([true, false, false, false, false, false]);
    // an edit: true command applies only while editing; anything else always
    for (const view of [edit, { hands: [] }]) for (const e of [true, false, undefined]) expect(inBody({ edit: e }, view)).toBe(e !== true || editing(view));
  });

  // Every sequence of up to 5 events (7^5 + … + 1 = 19,608).
  // (whether the editor is held is the stage's to keep, below: here it would only restate `apply`)
  it("over every sequence of ≤5 events: Look at the bottom and nowhere else; Leave pops the top and never Look; picking up or putting down the editor leaves the bodies be", () => {
    let n = 0;
    for (const seq of all(5)) {
      let m = [["look"], false];
      for (const ev of seq) {
        const [before] = m;
        m = apply(m, ev);
        const [stack] = m;
        expect(stack[0]).toBe("look");
        expect(stack.slice(1).includes("look")).toBe(false);
        if (ev === "leave") expect(stack).toEqual(before.length > 1 ? before.slice(0, -1) : before);
        else if (ev === "look") expect(stack).toEqual(["look"]);
        else if (ev === "edit" || ev === "unedit") expect(stack).toBe(before);
        else expect(stack.at(-1)).toBe(ev);
      }
      n++;
    }
    expect(n).toBe(1 + 7 + 49 + 343 + 2401 + 16807);
  });
});

// The same, on the stage itself: every sequence of up to 4 events, from a
// scene that starts people in Look and one made new (holding the editor).
// After each, the stage's body, depth and hands are the model's. Entering,
// leaving and the editor are synchronous, so no waiting between events.
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

  it("every sequence of ≤4 events, from Look and holding the editor", async () => {
    let n = 0;
    for (const start of [false, true]) {
      s = await mountStage({ extensions: [BODIES], doc: { view: { start: start ? { edit: true } : {} } } });
      const api = s.api("t.bodies");
      expect(editing(s.local.get())).toBe(start);
      for (const seq of all(4)) {
        // back to the start, nothing standing
        api.body.enter("look");
        s.edit(start);
        let m = [["look"], start];
        for (const ev of seq) {
          if (ev === "leave") expect(api.body.leave()).toBe(m[0].length > 1);
          else if (ev === "edit" || ev === "unedit") expect(s.edit(ev === "edit")).toBe(ev === "edit");
          else expect(api.body.enter(ev)).toBe(true);
          m = apply(m, ev);
          const b = s.local.get().body;
          expect([seq, ev, b.id, b.depth, editing(s.local.get())]).toEqual([seq, ev, m[0].at(-1), m[0].length - 1, m[1]]);
          expect(s.debug.router.bodies().map((x) => x.id)).toEqual(m[0]);
          expect(s.local.get().hands.map((h) => h.name)).toEqual(m[1] ? ["Edit"] : []);
        }
        n++;
      }
      s.unmount();
      s = null;
    }
    expect(n).toBe(2 * (1 + 7 + 49 + 343 + 2401));
  }, 60_000);

  it("a scene starts people holding the editor only where its view.start says edit: true; an old body: \"edit\" names no body", async () => {
    for (const [start, want] of [[{ edit: true }, true], [{}, false], [{ body: "edit" }, false], [{ edit: "yes" }, false]]) {
      s = await mountStage({ extensions: [BODIES], doc: { view: { start } } });
      expect([start, editing(s.local.get()), s.local.get().body.id]).toEqual([start, want, "look"]);
      s.unmount();
      s = null;
    }
  });
});
