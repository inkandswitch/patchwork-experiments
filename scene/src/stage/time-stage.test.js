// A stage on a manual clock (time.js; STAGE.md "Time"): everything that moves
// with time moves only as the clock is stepped, and nothing reads the wall,
// sets a real timer or asks for a real frame while it runs.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import { manualTime, MANUAL_EPOCH } from "./time.js";
import { STEP_S } from "./clock.js";

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  vi.restoreAllMocks();
});

/** An extension that uses every kind of time there is: a process, a timer, a frame, presence, a notice. */
function mover() {
  const seen = { steps: [], timer: null, frame: null, api: null };
  const ext = {
    meta: { id: "t.mover" },
    module: {
      create(api) {
        seen.api = api;
        api.clock.process({ step: (dt, t) => seen.steps.push(+t.toFixed(9)) });
        api.clock.after(500, () => (seen.timer = api.clock.now()));
        api.clock.frame((now) => (seen.frame = now));
        api.presence.set("here", true);
        return {};
      },
    },
  };
  return { ext, seen };
}

/** Real time's ways in, spied on from here: each call and who made it. */
function spyOnTheWall() {
  const calls = [];
  for (const [obj, key] of [
    [Date, "now"],
    [globalThis, "setTimeout"],
    [globalThis, "setInterval"],
    [globalThis, "requestAnimationFrame"],
  ]) {
    const real = obj[key].bind(obj);
    vi.spyOn(obj, key).mockImplementation((...args) => {
      // who called: the first frames outside vitest's spies
      const at = new Error().stack.split("\n").filter((l) => !/node_modules|time-stage\.test/.test(l)).slice(1, 3);
      // (the test's own fake repo settles on real timers: not the stage's)
      if (!/\/src\/test\//.test(at[0] ?? ""))
        calls.push(`${key} ${at.map((l) => l.trim().replace(/^at /, "").replace(/\(?file:.*\/src\//, "(")).join(" < ")}`);
      return real(...args);
    });
  }
  return calls;
}

describe("a stage on a manual clock", () => {
  it("moves only when stepped, by exactly the frames stepped, and never reads the wall while it runs", async () => {
    const time = manualTime({ yieldTo: () => Promise.resolve() });
    const { ext, seen } = mover();
    const s = await mountStage({ extensions: [ext], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] }, viewerId: "viewer:ana", time });
    mounted.push(s);
    await time.until(() => s.api("t.mover") && s.debug.clock.computing(), { frames: 10, what: "computing" });
    const calls = spyOnTheWall();
    const t0 = time.now();
    const steps0 = seen.steps.length;
    const k0 = time.frames();
    // nothing moves while nobody steps
    await s.settle();
    expect(time.now()).toBe(t0);
    expect(seen.steps.length).toBe(steps0);
    // 60 frames: one second of world time, on the process's grid
    // (the clock's first frame passes no time: there's no frame before it to measure from)
    await time.step(1);
    const w0 = s.debug.clock.t();
    const n0 = seen.steps.length;
    await time.step(60);
    expect(time.now()).toBe(MANUAL_EPOCH + (k0 + 61) * time.frameMs);
    expect(s.debug.clock.t() - w0).toBeCloseTo(1, 9);
    const stepped = seen.steps.slice(n0);
    expect(stepped.length).toBe(60);
    for (let i = 1; i < stepped.length; i++) expect(stepped[i] - stepped[i - 1]).toBeCloseTo(STEP_S, 8);
    expect(s.debug.clock.t()).toBeCloseTo(stepped.at(-1), 9);
    // the extension's frame came at the first frame, its timer at 500 ms of the stage's time
    expect(seen.frame).toBe(MANUAL_EPOCH + time.frameMs);
    expect(seen.timer).toBe(MANUAL_EPOCH + 500);
    // a notice lives NOTICE_MS of the stage's time
    seen.api.notify("hello");
    await s.settle();
    expect(s.local.get().notices.map((n) => n.text)).toEqual(["hello"]);
    expect(s.local.get().notices[0].at).toBe(time.now());
    await time.advance(5_900);
    expect(s.local.get().notices.length).toBe(1);
    await time.advance(200);
    await s.settle();
    expect(s.local.get().notices.length).toBe(0);
    expect(calls).toEqual([]);
  });
});
