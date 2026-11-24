// @vitest-environment happy-dom
// World time on either source of time (NATIVE.md, "Native services"; stage/time.js): a computing
// clock ticked once a frame steps its processes on the same grid, whatever the frame rate.
import { describe, it, expect, vi } from "vitest";
import { FRAME_MS, manualTime, realTime } from "../stage/time.js";
import { STEP_S, createClock } from "./clock.js";

const now0 = () => Promise.resolve(); // step()'s yield, without the event loop

/** One computing view's clock, ticked once a frame by `time` as the stage ticks it; every process step it makes, recorded. */
function computing(time) {
  const doc = { clock: { running: true, t: 0 }, objects: {} };
  let held = false;
  const clock = createClock({
    doc: () => doc,
    change: (fn) => fn(doc),
    claim: {
      take: () => ((held = true), () => (held = false)),
      holder: () => (held ? { viewer: "v", session: "s", mine: true } : null),
    },
    presence: { set() {}, sample: () => null, shownAt: () => null, rate() {} },
    eligible: () => ({ ok: true, why: null }),
    writable: () => true,
    viewer: "v",
    now: time.now,
  });
  const steps = [];
  clock.process({ step: (dt, t) => steps.push([dt, +t.toFixed(9)]) });
  const loop = () => {
    clock.tick(time.now());
    time.frame(loop);
  };
  time.frame(loop);
  return { clock, steps };
}

describe("processes see the same ticks either way", () => {
  it("over 2 s of world time: manual frames of 60, 24 and 7 Hz, and the browser's at 60 Hz, step every process on the same grid", async () => {
    const runs = [];
    for (const frameMs of [FRAME_MS, 1000 / 24, 1000 / 7]) {
      const time = manualTime({ frameMs, yieldTo: now0 });
      const { steps } = computing(time);
      // the first frame starts the clock (no time before it); then 2 s
      await time.step(1);
      await time.advance(2000);
      runs.push(steps);
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    try {
      const time = realTime();
      const { steps } = computing(time);
      vi.advanceTimersByTime(16); // the first frame
      vi.advanceTimersByTime(2000);
      runs.push(steps);
    } finally {
      vi.useRealTimers();
    }
    // every run steps the grid in order, each step STEP_S, from the first grid point on
    const k = Math.min(...runs.map((r) => r.length));
    expect(k).toBeGreaterThanOrEqual(119);
    const grid = Array.from({ length: k }, (_, i) => [STEP_S, +((i + 1) * STEP_S).toFixed(9)]);
    for (const r of runs) expect(r.slice(0, k)).toEqual(grid);
  });
});
