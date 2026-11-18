// The stage's one source of time (time.js): the manual clock probes step,
// against the real one, over finite cases.
import { describe, it, expect, vi, afterEach } from "vitest";
import { FRAME_MS, MANUAL_EPOCH, manualTime, realTime } from "./time.js";
import { STEP_S, createClock } from "../native/clock.js";

const now0 = () => Promise.resolve(); // step()'s yield, without the event loop

/** Every permutation of a list. */
function* permutations(xs) {
  if (xs.length <= 1) return yield xs;
  for (let i = 0; i < xs.length; i++) for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
}

describe("the manual clock", () => {
  it("stepping N frames advances time by exactly N frame lengths, for every N from 0 to 20 (210 in all) and three frame lengths", async () => {
    for (const frameMs of [FRAME_MS, 1000 / 24, 10]) {
      const time = manualTime({ frameMs, yieldTo: now0 });
      let frames = 0;
      for (let n = 0; n <= 20; n++) {
        await time.step(n);
        frames += n;
        expect(time.frames()).toBe(frames);
        expect(time.now()).toBe(MANUAL_EPOCH + frames * frameMs);
      }
      expect(frames).toBe(210);
      // advance(ms) is the frames ms takes, rounded up
      for (const ms of [0, 1, frameMs - 0.001, frameMs, frameMs + 0.001, 31 * frameMs]) {
        const before = time.frames();
        await time.advance(ms);
        expect(time.frames() - before).toBe(Math.max(0, Math.ceil(ms / frameMs - 1e-9)));
        expect(time.now()).toBe(MANUAL_EPOCH + time.frames() * frameMs);
      }
    }
  });

  it("reads no real time: no performance.now, Date.now, setTimeout, setInterval or requestAnimationFrame, from making it to stepping it", async () => {
    const real = ["setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"].map((k) => [k, vi.spyOn(globalThis, k)]);
    const clocks = [vi.spyOn(Date, "now"), vi.spyOn(globalThis.performance, "now")];
    try {
      const time = manualTime({ yieldTo: now0 });
      const seen = [];
      time.after(5, () => seen.push(["timer", time.now()]));
      time.frame((t, draw) => seen.push(["frame", t, draw]));
      await time.step(3);
      await time.until(() => time.frames() >= 5);
      expect(seen).toEqual([
        ["timer", MANUAL_EPOCH + 5],
        ["frame", MANUAL_EPOCH + FRAME_MS, false],
      ]);
      for (const [, spy] of real) expect(spy).not.toHaveBeenCalled();
      for (const spy of clocks) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const [, spy] of real) spy.mockRestore();
      for (const spy of clocks) spy.mockRestore();
    }
  });

  it("fires timers in due order (ties: the one set first), each at its due time, in the frame whose end it falls by; every order of setting them", async () => {
    // due times around frame ends: 0, inside the first, on its end, just past it, inside the second
    const dues = [0, 5, FRAME_MS, FRAME_MS + 0.5, 20, 20];
    for (const order of permutations([0, 1, 2, 3, 4, 5])) {
      const time = manualTime({ yieldTo: now0 });
      const fired = [];
      for (const i of order) time.after(dues[i], () => fired.push({ i, at: time.now(), frame: time.frames() }));
      await time.step(3);
      const want = order.map((i, k) => ({ i, k })).sort((a, b) => dues[a.i] - dues[b.i] || a.k - b.k);
      expect(fired.map((f) => f.i)).toEqual(want.map((w) => w.i));
      for (const f of fired) {
        expect(f.at).toBe(MANUAL_EPOCH + dues[f.i]);
        // during frame k (frames() is k − 1 while it runs) when its due time is in (end of k − 1, end of k]
        expect(f.frame).toBe(Math.max(0, Math.ceil(dues[f.i] / FRAME_MS) - 1));
      }
    }
  });

  it("runs a timer set by a timer in the same frame when it's due by its end, and never one cancelled", async () => {
    const time = manualTime({ yieldTo: now0 });
    const seen = [];
    time.after(2, () => {
      seen.push(`a@${time.now() - MANUAL_EPOCH}`);
      time.after(3, () => seen.push(`b@${time.now() - MANUAL_EPOCH}`)); // due 5: this frame
      time.after(20, () => seen.push(`c@${time.now() - MANUAL_EPOCH}`)); // due 22: the second frame
    });
    const cancel = time.after(4, () => seen.push("never"));
    cancel();
    time.tick();
    expect(seen).toEqual(["a@2", "b@5"]);
    time.tick();
    expect(seen).toEqual(["a@2", "b@5", "c@22"]);
    expect(time.pending()).toEqual({ frames: 0, timers: 0 });
  });

  it("runs a frame callback asked for during a frame at the next one, after that frame's timers; only the last frame of a step draws", async () => {
    const time = manualTime({ yieldTo: now0 });
    const seen = [];
    const loop = (t, draw) => {
      seen.push([time.frames(), draw]);
      time.frame(loop);
    };
    time.frame(loop);
    time.after(FRAME_MS * 2, () => seen.push(["timer", time.frames()]));
    await time.step(4);
    expect(seen).toEqual([
      [1, false],
      ["timer", 1],
      [2, false],
      [3, false],
      [4, true],
    ]);
    const cancel = time.frame(() => seen.push("never"));
    cancel();
    await time.step(1);
    expect(seen.at(-1)).toEqual([5, true]);
    // draw: false draws none
    await time.step(2, { draw: false });
    await time.advance(time.frameMs, { draw: false });
    expect(seen.slice(-3)).toEqual([[6, false], [7, false], [8, false]]);
  });

  it("ends a frame whatever its timers do: a timer re-arming itself at 0 runs four deep at once, then every 4 ms (a browser's nesting clamp)", async () => {
    const time = manualTime({ yieldTo: now0 });
    const at = [];
    const again = () => {
      at.push(time.now() - MANUAL_EPOCH);
      time.after(0, again);
    };
    time.after(0, again);
    time.tick();
    // levels 1–4 at 0 ms, then every 4 ms to the frame's end (16.67): 4, 8, 12, 16
    expect(at).toEqual([0, 0, 0, 0, 4, 8, 12, 16]);
    time.tick();
    expect(at.slice(8)).toEqual([20, 24, 28, 32]);
    // a timer set outside any timer is never clamped
    const t0 = time.now();
    let fired = null;
    time.after(0, () => (fired = time.now()));
    time.tick();
    expect(fired).toBe(t0);
  });

  it("a still frame takes no time: it runs the frame callbacks and the timers already due, and no other", async () => {
    const time = manualTime({ yieldTo: now0 });
    await time.step(3);
    const t0 = time.now();
    const seen = [];
    time.frame((t, draw) => seen.push(["frame", t, draw]));
    time.after(0, () => seen.push(["due", time.now()]));
    time.after(1, () => seen.push(["later", time.now()]));
    await time.step(5, { still: true });
    expect(time.now()).toBe(t0);
    expect(time.frames()).toBe(3);
    expect(seen).toEqual([
      ["due", t0],
      ["frame", t0, false],
    ]);
    time.tick();
    expect(seen.at(-1)).toEqual(["later", t0 + 1]);
  });

  it("keeps going when a callback throws, and keeps the error", async () => {
    const time = manualTime({ yieldTo: now0 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen = [];
    time.after(1, () => {
      throw new Error("boom");
    });
    time.after(2, () => seen.push("after"));
    time.tick();
    err.mockRestore();
    expect(seen).toEqual(["after"]);
    expect(time.errors().map((e) => e.message)).toEqual(["boom"]);
  });

  it("until: steps until the condition holds and gives its value; else fails loudly, with what it waited for and the state it saw", async () => {
    const time = manualTime({ yieldTo: now0 });
    expect(await time.until(() => "already")).toBe("already");
    expect(time.frames()).toBe(0);
    expect(await time.until(() => time.frames() >= 7 && time.frames())).toBe(7);
    expect(time.frames()).toBe(7);
    await expect(time.until(() => false, { frames: 3, what: "the door open", state: () => ({ door: "shut" }) })).rejects.toThrow(/not the door open after 3 frames \(0\.05 s\) — \{"door":"shut"\}/);
    expect(time.frames()).toBe(10);
    // its frames draw only when asked to
    const drawn = [];
    const loop = (t, draw) => (drawn.push(draw), time.frame(loop));
    time.frame(loop);
    await time.until(() => drawn.length >= 2);
    await time.until(() => drawn.length >= 4, { draw: true });
    expect(drawn).toEqual([false, false, true, true]);
    // a condition that throws is not yet true
    let n = 0;
    expect(
      await time.until(() => {
        if (++n < 3) throw new Error("not loaded");
        return true;
      }),
    ).toBe(true);
  });

  it("refuses a frame length that isn't positive", () => {
    for (const frameMs of [0, -1, NaN]) expect(() => manualTime({ frameMs })).toThrow(/frameMs/);
  });
});

describe("the real clock", () => {
  afterEach(() => vi.useRealTimers());

  it("is the browser's: frames from requestAnimationFrame at now(), timers from setTimeout, now() on the epoch", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    const time = realTime();
    expect(time.manual).toBe(false);
    expect(Math.abs(time.now() - Date.now())).toBeLessThan(1000);
    const seen = [];
    time.frame((t, draw) => seen.push(["frame", draw]));
    time.after(40, () => seen.push(["timer"]));
    const never = time.after(10, () => seen.push(["never"]));
    never();
    const t0 = time.now();
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([["frame", true], ["timer"]]);
    expect(time.now() - t0).toBeCloseTo(50, 3);
  });
});

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
