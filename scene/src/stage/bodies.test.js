// Look and Edit (./bodies.js, STAGE.md, "Bodies"): the stack the stage keeps, as a
// model and as the stage keeps it, over every sequence of entering and
// leaving. Finite and exhaustive: no randomness.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { editing, enterStep, inBody, isStageBody, leaveStep, startBase } from "./bodies.js";
import { mountStage } from "../test/stage-harness.js";

// What can happen: entering each body (the stage's two; walk, seat and
// station, a package's) and Leave.
const EVENTS = ["look", "edit", "walk", "seat", "station", "leave"];
const apply = (stack, ev) => (ev === "leave" ? leaveStep(stack) : enterStep(stack, ev));

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
  it("the stage's two, and what reads them", () => {
    expect(["look", "edit", "walk", "orbit", null].map(isStageBody)).toEqual([true, true, false, false, false]);
    expect([{ body: { id: "edit" } }, { body: { id: "look" } }, { body: { id: "walk" } }, {}, null].map(editing)).toEqual([true, false, false, false, false]);
    // an edit: true command is Edit's; anything else is everyone's
    for (const body of ["look", "edit", "walk"])
      for (const edit of [true, false, undefined]) expect(inBody({ edit }, { body: { id: body } })).toBe(edit !== true || body === "edit");
    // where a doc starts people: Edit only where it says so
    expect(["edit", "look", "walk", "seat", "orbit", null].map((b) => startBase(b).id)).toEqual(["edit", "look", "look", "look", "look", "look"]);
  });

  // Every sequence of up to 5 events from each start (6^5 + … + 1 = 9,331 each).
  it("over every sequence of ≤5 enters and leaves: Look or Edit at the bottom; nothing stands on Edit; Leave never comes back to Edit", () => {
    let n = 0;
    for (const start of [["look"], ["edit"]]) {
      for (const seq of all(5)) {
        let stack = start;
        for (const ev of seq) {
          const before = stack;
          stack = apply(stack, ev);
          // the bottom is always one of the stage's
          expect(isStageBody(stack[0])).toBe(true);
          // only the bottom is the stage's
          expect(stack.slice(1).every((b) => !isStageBody(b))).toBe(true);
          // nothing stands on Edit
          if (stack[0] === "edit") expect(stack).toEqual(["edit"]);
          if (ev === "leave") {
            // the top goes and the one under carries on; the bottom never leaves
            expect(stack).toEqual(before.length > 1 ? before.slice(0, -1) : before);
            // so Leave never lands in Edit, unless already there
            if (stack.at(-1) === "edit") expect(before).toEqual(["edit"]);
          } else if (isStageBody(ev)) expect(stack).toEqual([ev]);
          else expect(stack.at(-1)).toBe(ev);
        }
        n++;
      }
    }
    expect(n).toBe(2 * (1 + 6 + 36 + 216 + 1296 + 7776));
  });

});

// The same, on the stage itself: every sequence of up to 4 events, from a
// scene that starts people in Look and one made new (Edit). After each, the
// stage's body and depth are the model's. Entering and leaving are
// synchronous, so no waiting between events.
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

  it("every sequence of ≤4 enters and leaves, from Look and from Edit", async () => {
    let n = 0;
    for (const start of ["look", "edit"]) {
      s = await mountStage({ extensions: [BODIES], doc: { view: { start: start === "edit" ? { body: "edit" } : {} } } });
      const api = s.api("t.bodies");
      expect(s.local.get().body.id).toBe(start);
      for (const seq of all(4)) {
        // back to the start, nothing standing
        api.body.enter(start);
        let model = [start];
        for (const ev of seq) {
          if (ev === "leave") expect(api.body.leave()).toBe(model.length > 1);
          else expect(api.body.enter(ev)).toBe(true);
          model = apply(model, ev);
          const b = s.local.get().body;
          expect([seq, ev, b.id, b.depth]).toEqual([seq, ev, model.at(-1), model.length - 1]);
          expect(s.debug.router.bodies().map((x) => x.id)).toEqual(model);
        }
        n++;
      }
      s.unmount();
      s = null;
    }
    expect(n).toBe(2 * (1 + 6 + 36 + 216 + 1296));
  }, 60_000);
});
