// @vitest-environment happy-dom
// scene.clock-chip: the chip's words (pure), and the chip on a mounted stage with
// a process, paused and resumed through it.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, settle } from "../test/stage-harness.js";
import { manualTime } from "../stage/time.js";
import { chipOf } from "./clock.js";
import clockPart from "./clock.js";

const name = (v) => (v === "me" ? "you" : v === "automerge:ben" ? "Ben" : "someone");
const status = (o) => ({ running: true, by: null, computer: null, stalled: false, able: true, why: null, ...o });

const RUN = (text) => ({ icon: "▶", text, action: "pause", label: "Pause" });
const PAUSED = (text) => ({ icon: "⏸", text, action: "resume", label: "Resume" });
const BEN = { viewer: "automerge:ben", mine: false };

describe("what the chip says", () => {
  // who computes is said only when it's news: a stall, or nobody here able to
  it.each([
    ["a doc with no process: nothing", null, null],
    ["running, with Pause", status({ computer: BEN }), RUN("Running")],
    ["paused by whom, with Resume", status({ running: false, by: "automerge:ben" }), PAUSED("Paused by Ben")],
    ["paused by you", status({ running: false, by: "me" }), PAUSED("Paused by you")],
    ["paused by nobody known", status({ running: false }), PAUSED("Paused")],
    ["another machine stalls", status({ computer: BEN, stalled: true }), RUN("Waiting for Ben's machine")],
    ["nobody here can (and why)", status({ able: false, why: "view only" }), RUN("Nobody here can run it (view only)")],
    ["nobody here can, with no process", status({ able: false, why: "no process" }), RUN("Nobody here can run it")],
    ["it computes here, stalled: nothing to say", status({ computer: { viewer: "me", mine: true }, stalled: true }), RUN("Running")],
  ])("%s", (_name, st, want) => expect(chipOf(st, name)).toEqual(want));
});

// on the stage's manual time: frames, the clock's ticks and its checkpoints move only as it is stepped
describe("the chip on a stage", () => {
  const mounted = [];
  let time;
  beforeEach(() => (time = manualTime()));
  afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
  });

  it("shows ▶ while this view computes a process; its button pauses the doc's clock, and resumes it", async () => {
    const steps = [];
    const PROC = {
      meta: { id: "t.proc" },
      module: {
        create(api) {
          api.use("clock").process({ step: (dt, t) => steps.push(t), save: () => {} });
          return {};
        },
      },
    };
    const CHIP = { meta: { id: "scene.clock-chip" }, module: clockPart };
    const s = await mountStage({ natives: true,  time, extensions: [PROC, CHIP], viewerId: "me" });
    mounted.push(s);
    const clock = () => s.api("t.proc").use("clock");
    await time.until(() => clock().computer()?.mine);
    const chip = s.root.querySelector(".clock-chip");
    expect(s.root.querySelector(".clock-bar").hidden).toBe(false);
    expect(chip.closest(".stage-edge").dataset.edge).toBe("top"); // beside the view, not over it
    expect(chip.querySelector(".clock-text").textContent).toBe("▶ Running");
    expect(s.doc().claims.clock.session).toBe(s.api("t.proc").channel.session);
    // frames pass: the process is stepped on its grid
    await time.until(() => steps.length > 3);
    chip.querySelector(".clock-toggle").click();
    await settle();
    expect(s.doc().clock).toMatchObject({ running: false, by: "me" });
    expect(s.doc().claims.clock).toBeUndefined();
    expect(chip.querySelector(".clock-text").textContent).toBe("⏸ Paused by you");
    const n = steps.length;
    const t = clock().t();
    expect(t).toBe(s.doc().clock.t);
    await time.advance(100);
    expect(steps.length).toBe(n); // no time passes paused
    expect(clock().t()).toBe(t);
    chip.querySelector(".clock-toggle").click();
    await time.until(() => clock().computer()?.mine);
    expect(s.doc().clock.running).toBe(true);
    await time.until(() => steps.length > n);
    expect(steps[n]).toBeGreaterThan(t);
  });

  it("a process's removal while computing saves it first; the last one gone, the clock lets go", async () => {
    const saves = [];
    let remove = null;
    const PROC = {
      meta: { id: "t.proc" },
      module: {
        create(api) {
          remove = api.use("clock").process({ step() {}, save: (d) => saves.push(typeof d.objects) });
          return {};
        },
      },
    };
    const s = await mountStage({ natives: true,  time, extensions: [PROC] });
    mounted.push(s);
    const computing = () => !!s.api("t.proc").use("clock").computer()?.mine;
    await time.until(computing);
    await time.step(3); // a few frames of world time
    remove();
    expect(saves).toEqual(["object"]);
    await settle();
    expect(computing()).toBe(false);
    expect(s.doc().claims?.clock).toBeUndefined();
    expect(s.doc().clock.t).toBeGreaterThan(0);
  });

  it("an extension that failed to start keeps this view from computing, and the chip says so", async () => {
    // (the old rule, again: the clock computes only when everything the doc calls for is running; the failed one's processes would stand still while time passed)
    const steps = [];
    const PROC = { meta: { id: "t.proc" }, module: { create: (api) => (api.use("clock").process({ step: (dt, t) => steps.push(t), save: () => {} }), {}) } };
    const BROKEN = { meta: { id: "t.broken" }, module: { create: () => { throw new Error("boom"); } } };
    const CHIP = { meta: { id: "scene.clock-chip" }, module: clockPart };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await mountStage({ natives: true,  time, extensions: [PROC, BROKEN, CHIP] });
    mounted.push(s);
    const api = s.api("t.proc");
    await time.until(() => api.settled().failed.includes("t.broken"));
    expect(api.settled()).toMatchObject({ ready: true, missing: [] }); // nothing else is on its way: only the failure stops it
    await time.until(() => api.use("clock").status()?.why === "an extension failed");
    await time.advance(100); // frames pass
    expect(api.use("clock").computer()).toBeNull();
    expect(s.doc().claims?.clock).toBeUndefined();
    expect(steps).toEqual([]);
    expect(s.root.querySelector(".clock-text").textContent).toContain("Nobody here can run it (an extension failed)");
    warn.mockRestore();
  });

  it("a closing stage checkpoints every process in one change, before its claim goes", async () => {
    const saves = []; // each save's draft, while the claim is still in it
    const proc = (id) => ({ meta: { id }, module: { create: (api) => (api.use("clock").process({ step() {}, save: (d) => saves.push(d.claims?.clock && d) }), {}) } });
    const s = await mountStage({ natives: true,  time, extensions: [proc("t.a"), proc("t.b")] });
    await time.until(() => s.api("t.a").use("clock").computer()?.mine);
    s.unmount();
    expect(saves.length === 2 && saves[0] && saves[0] === saves[1]).toBe(true);
  });
});
