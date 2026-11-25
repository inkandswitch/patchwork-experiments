// The run's task code with a fake context and a fake runJob (no solver):
// the guard that never solves a run twice, each reason the task's signal can
// give, a run doc that arrives late, a runJob that throws, gmsh or CalculiX
// missing, and what reaches the task's view.
import { describe, it, expect, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeRunTask, machineSettings, thisMachine, progressOf } from "./run-task.mjs";
import { FakeRepo } from "../src/test/fake-repo.js";
import { newRun, NOT_RESTARTED, MACHINE_STOPPED, markStopped } from "../src/protocol.js";
import { normalizeSetup } from "../src/setup.js";
import { findWhenThere } from "../src/find.js";

let repo, run, calls, awake, released;
const MACHINE = { tools: { gmsh: "/x/gmsh", ccx: "/x/ccx", gmshVersion: "4.15", ccxVersion: "2.23" }, cores: 4, maxNodes: 100_000, state: "/tmp/fea-state", sync: "wss://example.invalid", info: { host: "here", calculix: "2.23", gmsh: "4.15" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ studyUrl: "automerge:s", serverUrl: "automerge:q", setup: normalizeSetup(null), part: {}, now: 1 }));
  calls = [];
  awake = 0;
  released = 0;
});

const taken = (id) => ({ id, pool: "p", start: 0 });
const stopRecord = (id) => ({ id, start: 0, end: 0, status: "cancelled" });

/** A task document with these records, and a context for the run named `me`. */
function context(records, me, { signal = new AbortController().signal } = {}) {
  const task = repo.add({ importUrl: "/x/daemon/run-task.mjs", input: { run: run.url }, key: run.url, runs: records });
  const said = { progress: [], logs: [] };
  return { said, ctx: { repo, taskUrl: task.url, run: me, key: run.url, signal, log: (m) => said.logs.push(m), progress: (p) => said.progress.push(p) } };
}

/** findWhenThere with no wait between tries. */
const findNow = (r, url) => findWhenThere(r, url, { tries: 3, sleep: async () => {} });

function task(runJob, { machine = () => MACHINE, find = findNow } = {}) {
  return makeRunTask({
    find,
    runJob: async (o) => {
      calls.push(o);
      return runJob(o);
    },
    machine,
    awake: () => {
      awake++;
      return () => released++;
    },
    peer: () => ({ verify: async () => [], close: async () => {} }),
    say: () => {},
  });
}

const finishes = async ({ handle }) => {
  handle.change((d) => (d.status = "done"));
  return "done";
};

describe("the guard", () => {
  it("the first run solves, with the machine's tools, cores, mesh cap and directories", async () => {
    const { ctx } = context([taken("r1")], "r1");
    const out = await task(finishes)({ run: run.url }, ctx);
    expect(out).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handle: run, tools: MACHINE.tools, cores: 4, maxNodes: 100_000, workDir: "/tmp/fea-state/runs", daemon: MACHINE.info, signal: ctx.signal });
  });
  it("a run after another never solves: the run doc says it was interrupted, and the task fails", async () => {
    run.change((d) => {
      d.status = "solving";
      d.stages[3].status = "running";
    });
    const { ctx } = context([taken("r0"), taken("r1")], "r1");
    await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect(calls).toHaveLength(0);
    expect([run.doc().status, run.doc().error, run.doc().stages[3].status]).toEqual(["failed", NOT_RESTARTED, "failed"]);
  });
  it("a run after a lost one never solves either (lost or open, a run before is a run before)", async () => {
    const { ctx } = context([{ ...taken("r0"), end: 1, status: "lost" }, taken("r1")], "r1");
    await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect(calls).toHaveLength(0);
  });
  it("a stop recorded before this run is not a run: the guard lets it through (the stop itself is the pool's to act on)", async () => {
    const { ctx } = context([stopRecord("s0"), taken("r1")], "r1");
    expect(await task(finishes)({ run: run.url }, ctx)).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
  });
  it("a stop recorded after this run changes nothing for the guard", async () => {
    const { ctx } = context([taken("r1"), stopRecord("s1")], "r1");
    expect(await task(finishes)({ run: run.url }, ctx)).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
  });
  it("a run after a stop and a run: the run before counts", async () => {
    const { ctx } = context([stopRecord("s0"), taken("r0"), taken("r1")], "r1");
    await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect(calls).toHaveLength(0);
  });
  it("a run doc that already says its machine stopped keeps saying so", async () => {
    run.change((d) => markStopped(d, "stopping", 5));
    const { ctx } = context([taken("r0"), taken("r1")], "r1");
    await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect([run.doc().status, run.doc().error]).toEqual(["failed", MACHINE_STOPPED]);
  });
  it("a run that can't find itself in its task doesn't start", async () => {
    const { ctx } = context([taken("r0")], "r9");
    await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(/not started/);
    expect(calls).toHaveLength(0);
    expect(run.doc().status).toBe("queued");
  });
});

describe("how a run ends", () => {
  it("a solver failure fails the task once, with the run doc's error", async () => {
    const { ctx } = context([taken("r1")], "r1");
    const t = task(async ({ handle }) => {
      handle.change((d) => {
        d.status = "failed";
        d.error = "*ERROR in e_c3d: nonpositive jacobian";
      });
      return "failed";
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow("*ERROR in e_c3d: nonpositive jacobian");
    expect(calls).toHaveLength(1);
  });
  for (const reason of ["cancelled", "stopping", "yielded"])
    it(`told to stop (${reason}): lets go of sleep at once, throws, and writes nothing of its own to the run doc`, async () => {
      const abort = new AbortController();
      const { ctx } = context([taken("r1")], "r1", { signal: abort.signal });
      let releasedAtAbort = null;
      // a runner that, told to stop, says nothing and fails as a killed program would
      const t = task(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => {
              releasedAtAbort = released;
              reject(new Error("gmsh stopped (exit SIGTERM)"));
            }),
          ),
      );
      const going = t({ run: run.url }, ctx);
      await new Promise((r) => setTimeout(r, 10));
      abort.abort(reason);
      await expect(going).rejects.toThrow("gmsh stopped");
      expect(calls[0].signal).toBe(abort.signal);
      // the abort's own listener let go before the runner's did anything
      expect([awake, releasedAtAbort]).toEqual([1, 1]);
      // what the run doc says is the runner's (markStopped), never a failure from here
      expect(run.doc().status).toBe("queued");
    });
  it("told to stop, a runner that returns: the task throws anyway (what it says after an abort isn't counted)", async () => {
    const abort = new AbortController();
    const { ctx } = context([taken("r1")], "r1", { signal: abort.signal });
    const t = task(({ signal }) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("stopped"))));
    const going = t({ run: run.url }, ctx);
    await new Promise((r) => setTimeout(r, 10));
    abort.abort("cancelled");
    await expect(going).rejects.toThrow("stopped (cancelled)");
  });
  it("told to stop, a runner stuck in a wait that watches no signal: the task throws after stopWait, so what was written is saved before the thread is ended", async () => {
    const abort = new AbortController();
    const { ctx } = context([taken("r1")], "r1", { signal: abort.signal });
    const t = makeRunTask({
      find: findNow,
      runJob: ({ handle, signal }) => {
        // the runner's own stop record, then a wait that never ends
        signal.addEventListener("abort", () => handle.change((d) => markStopped(d, signal.reason, 9)));
        return new Promise(() => {});
      },
      machine: () => MACHINE,
      awake: () => () => {},
      peer: () => ({ verify: async () => [], close: async () => {} }),
      say: () => {},
      stopWait: 20,
    });
    const going = t({ run: run.url }, ctx);
    await new Promise((r) => setTimeout(r, 10));
    abort.abort("cancelled");
    await expect(going).rejects.toThrow("stopped (cancelled)");
    expect(run.doc().status).toBe("cancelled");
  });
  it("a runner that ends by itself is never cut short: with no abort, stopWait never starts", async () => {
    const { ctx } = context([taken("r1")], "r1");
    const t = makeRunTask({
      find: findNow,
      runJob: async (o) => {
        await new Promise((r) => setTimeout(r, 40));
        return finishes(o);
      },
      machine: () => MACHINE,
      awake: () => () => {},
      peer: () => ({ verify: async () => [], close: async () => {} }),
      say: () => {},
      stopWait: 1,
    });
    expect(await t({ run: run.url }, ctx)).toEqual({ status: "done" });
  });
  it("a runJob that throws fails the run doc as well as the task", async () => {
    const { ctx } = context([taken("r1")], "r1");
    const t = task(async () => {
      throw new Error("the run's setup can't be read");
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow("the run's setup can't be read");
    expect([run.doc().status, run.doc().error]).toEqual(["failed", "the run's setup can't be read"]);
  });
  it("gmsh or CalculiX missing: the run doc and the task fail with the sentence, and nothing runs", async () => {
    const { ctx } = context([taken("r1")], "r1");
    const why = "The machine serving this queue (here) can't run it: no gmsh found: install it (macOS: brew install gmsh; Debian: apt install gmsh), or pass --gmsh.";
    const t = task(finishes, {
      machine: () => {
        throw new Error(why);
      },
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow(why);
    expect(calls).toHaveLength(0);
    expect([run.doc().status, run.doc().error]).toEqual(["failed", why]);
  });
  it("refuses an input that names no run, or names something that isn't an FEA run", async () => {
    const { ctx } = context([taken("r1")], "r1");
    await expect(task(finishes)({}, ctx)).rejects.toThrow(/names no run/);
    await expect(task(finishes)({ run: "automerge:nothing-here" }, ctx)).rejects.toThrow(/unavailable/);
    const other = repo.add({ "@patchwork": { type: "openfoam-run" } });
    await expect(task(finishes)({ run: other.url }, ctx)).rejects.toThrow(/isn't an FEA run/);
    expect(calls).toHaveLength(0);
  });
  it("waits for a run doc that reaches the machine after its task", async () => {
    const { ctx } = context([taken("r1")], "r1");
    let asked = 0;
    const late = { find: async (url) => (url === run.url && ++asked < 3 ? Promise.reject(new Error(`Document ${url} is unavailable`)) : repo.find(url)) };
    const out = await task(finishes)({ run: run.url }, { ...ctx, repo: Object.assign(Object.create(repo), late) });
    expect([out, asked, calls.length]).toEqual([{ status: "done" }, 3, 1]);
  });
});

describe("the machine, from the environment", () => {
  it("reads its settings from the environment, with the defaults", () => {
    expect(machineSettings({})).toMatchObject({ gmsh: undefined, ccx: undefined, maxNodes: 250_000, state: join(homedir(), ".patchwork-fea"), sync: "wss://subduction.sync.inkandswitch.com" });
    expect(machineSettings({ GMSH: "/g", CCX: "/c", FEAD_CORES: "3", FEAD_MAX_NODES: "5000", FEAD_STATE: "/s", PATCHWORK_SYNC: "wss://x" })).toEqual({ gmsh: "/g", ccx: "/c", cores: 3, maxNodes: 5000, state: "/s", sync: "wss://x" });
    // a cap below a thousand nodes is a slip
    expect(machineSettings({ FEAD_MAX_NODES: "10" }).maxNodes).toBe(1000);
  });
  it("gmsh missing, CalculiX missing, or either not starting: a sentence saying which, on which machine", () => {
    expect(() => thisMachine({ GMSH: "/no/such/gmsh" })).toThrow(/^The machine serving this queue \(.+\) can't run it: no gmsh at \/no\/such\/gmsh\.$/);
    expect(() => thisMachine({ GMSH: "/usr/bin/false", CCX: "/no/such/ccx" })).toThrow(/can't run it: no ccx at \/no\/such\/ccx\.$/);
    expect(() => thisMachine({ GMSH: "/usr/bin/false", CCX: "/usr/bin/false" })).toThrow(/can't run it: gmsh at \/usr\/bin\/false didn't start\.$/);
  });
});

describe("what a task view is told", () => {
  it("the status and the stage as the run doc has them, and a log line per stage", async () => {
    const { ctx, said } = context([taken("r1")], "r1");
    await task(async ({ handle }) => {
      handle.change((d) => {
        d.status = "meshing";
        d.stages[0].status = "running";
      });
      handle.change((d) => {
        d.stages[0].status = "done";
        d.stages[1].status = "running";
      });
      handle.change((d) => {
        d.stages[1].status = "done";
        d.stages[3].status = "running";
        d.status = "solving";
      });
      handle.change((d) => (d.status = "done"));
      return "done";
    })({ run: run.url }, ctx);
    expect(said.progress.map((p) => `${p.status}|${p.stage}`)).toEqual(["queued|null", "meshing|Read the part", "meshing|Mesh it (gmsh)", "solving|Solve (CalculiX)", "done|Solve (CalculiX)"]);
    expect(said.logs).toEqual(["Read the part", "Mesh it (gmsh)", "Solve (CalculiX)", "done"]);
    expect(progressOf(run.doc())).toEqual({ status: "done", stage: "Solve (CalculiX)" });
  });
});
