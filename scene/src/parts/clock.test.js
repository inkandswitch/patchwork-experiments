// scene.clock: the chip's words (pure), and the chip on a mounted stage with
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
          api.clock.process({ step: (dt, t) => steps.push(t), save: () => {} });
          return {};
        },
      },
    };
    const CHIP = { meta: { id: "scene.clock" }, module: clockPart };
    const s = await mountStage({ extensions: [PROC, CHIP], viewerId: "me" });
    mounted.push(s);
    await until(() => s.local.get().clock?.computer?.mine);
    const chip = s.root.querySelector(".clock-chip");
    expect(s.root.querySelector(".clock-bar").hidden).toBe(false);
    expect(chip.closest(".stage-edge").dataset.edge).toBe("top"); // beside the view, not over it
    expect(chip.querySelector(".clock-text").textContent).toBe("▶ Running");
    expect(s.doc().claims.clock.session).toBe(s.api("t.proc").session);
    // frames pass: the process is stepped on its grid
    await until(() => steps.length > 3);
    chip.querySelector(".clock-toggle").click();
    await settle();
    expect(s.doc().clock).toMatchObject({ running: false, by: "me" });
    expect(s.doc().claims.clock).toBeUndefined();
    expect(chip.querySelector(".clock-text").textContent).toBe("⏸ Paused by you");
    const n = steps.length;
    const t = s.api("t.proc").clock.t();
    expect(t).toBe(s.doc().clock.t);
    await new Promise((r) => setTimeout(r, 100));
    expect(steps.length).toBe(n); // no time passes paused
    expect(s.api("t.proc").clock.t()).toBe(t);
    chip.querySelector(".clock-toggle").click();
    await until(() => s.local.get().clock?.computer?.mine);
    expect(s.doc().clock.running).toBe(true);
    await until(() => steps.length > n);
    expect(steps[n]).toBeGreaterThan(t);
  });

  it("no process, no chip", async () => {
    const CHIP = { meta: { id: "scene.clock" }, module: clockPart };
    const s = await mountStage({ extensions: [CHIP] });
    mounted.push(s);
    await settle();
    expect(s.local.get().clock).toBeNull();
    expect(s.root.querySelector(".clock-bar").hidden).toBe(true);
  });

  it("a process's removal while computing saves it first; the last one gone, the clock lets go", async () => {
    const saves = [];
    let remove = null;
    const PROC = {
      meta: { id: "t.proc" },
      module: {
        create(api) {
          remove = api.clock.process({ step() {}, save: (d) => saves.push(typeof d.objects) });
          return {};
        },
      },
    };
    const s = await mountStage({ extensions: [PROC] });
    mounted.push(s);
    await until(() => s.debug.clock.computing());
    remove();
    expect(saves).toEqual(["object"]);
    await settle();
    expect(s.debug.clock.computing()).toBe(false);
    expect(s.doc().claims?.clock).toBeUndefined();
    expect(s.doc().clock.t).toBeGreaterThan(0);
  });
});
