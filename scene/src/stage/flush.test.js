import { describe, expect, it } from "vitest";
import { createFlush, UI_BUDGET_MS, UI_PASSES } from "./flush.js";

/** Frames by hand: frame(fn) → cancel; step() runs what asked for this frame, in order. */
function frames() {
  let waiting = [];
  return {
    frame: (fn) => (waiting.push(fn), () => (waiting = waiting.filter((f) => f !== fn))),
    step: () => {
      const now = waiting;
      waiting = [];
      for (const fn of now) fn();
    },
    get waiting() {
      return waiting.length;
    },
  };
}
const drain = () => new Promise((r) => setTimeout(r, 0));

describe("when the update flush runs (flush.js)", () => {
  // Every chain of passes that each ask for one more (an update that swaps local), over a pass costing nothing
  // or more than the whole budget, on a real or a manual clock: no request is lost. A request is judged on the
  // passes finished when it is made, so one made during a pass doesn't count that pass: before a frame goes by,
  // the chain runs UI_PASSES + 1 passes, or 2 when a pass costs more than the budget (unless the clock is manual).
  it("over every chain of ≤6 passes × cost 0 or over budget × real or manual clock: none lost, the first frame's passes as the budget says", async () => {
    let cases = 0;
    for (let chain = 1; chain <= 6; chain++)
      for (const cost of [0, UI_BUDGET_MS + 1])
        for (const manual of [false, true]) {
          const f = frames();
          let cpu = 0;
          let passes = 0;
          const flush = createFlush({
            frame: f.frame,
            manual: () => manual,
            cpu: () => cpu,
            pass: () => {
              passes++;
              cpu += cost;
              if (passes < chain) flush.request();
            },
          });
          flush.request();
          await drain();
          const free = manual || cost === 0 ? UI_PASSES + 1 : 2;
          expect([chain, cost, manual, passes]).toEqual([chain, cost, manual, Math.min(chain, free)]);
          for (let i = 0; i < chain * 2 && passes < chain; i++) {
            f.step();
            await drain();
          }
          expect([chain, cost, manual, passes]).toEqual([chain, cost, manual, chain]);
          cases++;
        }
    expect(cases).toBe(24);
  });

  it("requests before a pass are one pass; disposed, a waiting pass never runs and nothing is left waiting", async () => {
    const f = frames();
    let passes = 0;
    const flush = createFlush({ frame: f.frame, cpu: () => 0, pass: () => passes++ });
    flush.request();
    flush.request();
    await drain();
    expect(passes).toBe(1);
    for (let i = 0; i < UI_PASSES; i++) flush.request(), await drain();
    expect(passes).toBe(UI_PASSES);
    flush.request(); // past the pass count: waits for the frame
    await drain();
    expect([passes, f.waiting]).toEqual([UI_PASSES, 2]);
    flush.dispose();
    expect(f.waiting).toBe(0);
    flush.request();
    f.step();
    await drain();
    expect(passes).toBe(UI_PASSES);
  });
});
