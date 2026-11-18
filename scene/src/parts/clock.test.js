// scene.clock-chip: the chip's words (pure), and the chip on a mounted stage with
// a process, paused and resumed through it.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, settle, until } from "../test/stage-harness.js";
import { chipOf } from "./clock.js";
import clockPart from "./clock.js";

const name = (v) => (v === "me" ? "you" : v === "automerge:ben" ? "Ben" : "someone");
const status = (o) => ({ running: true, by: null, computer: null, stalled: false, able: true, why: null, ...o });

describe("what the chip says", () => {
  it("nothing for a doc with no process", () => expect(chipOf(null, name)).toBeNull());
  it("running, with Pause", () => expect(chipOf(status({ computer: { viewer: "automerge:ben", mine: false } }), name)).toEqual({ icon: "▶", text: "Running", action: "pause", label: "Pause" }));
  it("paused by whom, with Resume", () => {
    expect(chipOf(status({ running: false, by: "automerge:ben" }), name)).toEqual({ icon: "⏸", text: "Paused by Ben", action: "resume", label: "Resume" });
    expect(chipOf(status({ running: false, by: "me" }), name).text).toBe("Paused by you");
    expect(chipOf(status({ running: false }), name).text).toBe("Paused");
  });
  it("who computes only when it's news: a stall, or nobody here able to", () => {
    expect(chipOf(status({ computer: { viewer: "automerge:ben", mine: false }, stalled: true }), name).text).toBe("Waiting for Ben's machine");
    expect(chipOf(status({ computer: { viewer: "automerge:ben", mine: false }, stalled: false }), name).text).toBe("Running");
    expect(chipOf(status({ able: false, why: "view only" }), name).text).toBe("Nobody here can run it (view only)");
    expect(chipOf(status({ able: false, why: "no process" }), name).text).toBe("Nobody here can run it");
    // it computes here: nothing to say
    expect(chipOf(status({ computer: { viewer: "me", mine: true }, stalled: true }), name).text).toBe("Running");
  });
});

describe("the chip on a stage", () => {
  const mounted = [];
  afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
  });

  it("shows ▶ while this view computes a process, pauses for everyone, and resumes", async () => {
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
    const s = await mountStage({ extensions: [PROC, CHIP], viewerId: "me" });
    mounted.push(s);
    const clock = () => s.api("t.proc").use("clock");
    await until(() => clock().computer()?.mine);
    const chip = s.root.querySelector(".clock-chip");
    expect(s.root.querySelector(".clock-bar").hidden).toBe(false);
    expect(chip.closest(".stage-edge").dataset.edge).toBe("top"); // beside the view, not over it
    expect(chip.querySelector(".clock-text").textContent).toBe("▶ Running");
    expect(s.doc().claims.clock.session).toBe(s.api("t.proc").channel.session);
    // frames pass: the process is stepped on its grid
    await until(() => steps.length > 3);
    chip.querySelector(".clock-toggle").click();
    await settle();
    expect(s.doc().clock).toMatchObject({ running: false, by: "me" });
    expect(s.doc().claims.clock).toBeUndefined();
    expect(chip.querySelector(".clock-text").textContent).toBe("⏸ Paused by you");
    const n = steps.length;
    const t = clock().t();
    expect(t).toBe(s.doc().clock.t);
    await new Promise((r) => setTimeout(r, 100));
    expect(steps.length).toBe(n); // no time passes paused
    expect(clock().t()).toBe(t);
    chip.querySelector(".clock-toggle").click();
    await until(() => clock().computer()?.mine);
    expect(s.doc().clock.running).toBe(true);
    await until(() => steps.length > n);
    expect(steps[n]).toBeGreaterThan(t);
  });

  it("no process, no chip", async () => {
    const CHIP = { meta: { id: "scene.clock-chip" }, module: clockPart };
    const s = await mountStage({ extensions: [CHIP] });
    mounted.push(s);
    await settle();
    expect(s.api("scene.clock-chip").use("clock").status()).toBeNull();
    expect(s.root.querySelector(".clock-bar").hidden).toBe(true);
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
    const s = await mountStage({ extensions: [PROC] });
    mounted.push(s);
    const computing = () => !!s.api("t.proc").use("clock").computer()?.mine;
    await until(computing);
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
    const s = await mountStage({ extensions: [PROC, BROKEN, CHIP] });
    mounted.push(s);
    const api = s.api("t.proc");
    await until(() => api.settled().failed.includes("t.broken"));
    expect(api.settled()).toMatchObject({ ready: true, missing: [] }); // nothing else is on its way: only the failure stops it
    await until(() => api.use("clock").status()?.why === "an extension failed");
    await new Promise((r) => setTimeout(r, 100)); // frames pass
    expect(api.use("clock").computer()).toBeNull();
    expect(s.doc().claims?.clock).toBeUndefined();
    expect(steps).toEqual([]);
    expect(s.root.querySelector(".clock-text").textContent).toContain("Nobody here can run it (an extension failed)");
    warn.mockRestore();
  });

  it("a closing stage checkpoints every process in one change, before its claim goes", async () => {
    const saves = []; // each save's draft, while the claim is still in it
    const proc = (id) => ({ meta: { id }, module: { create: (api) => (api.use("clock").process({ step() {}, save: (d) => saves.push(d.claims?.clock && d) }), {}) } });
    const s = await mountStage({ extensions: [proc("t.a"), proc("t.b")] });
    await until(() => s.api("t.a").use("clock").computer()?.mine);
    s.unmount();
    expect(saves.length === 2 && saves[0] && saves[0] === saves[1]).toBe(true);
  });
});
