// @vitest-environment node
// The run's task code with a fake context and a fake runJob (no solver):
// the guard that never solves a run twice, what reaches the task's view, and
// what it returns or throws for each way a run ends.
import { describe, it, expect, beforeEach } from "vitest";
import { makeRunTask, progressOf } from "./run-task.mjs";
import { FakeRepo } from "../probes/fake-repo.js";
import { newRun, NOT_RESTARTED, MACHINE_STOPPED, markStopped } from "../src/protocol.js";
import { defaultSetup } from "../src/setup.js";
import { findWhenThere } from "../src/find.js";

let repo, run, calls, awake, released;
const MACHINE = { env: { describe: "fake" }, cores: 4, state: "/tmp/openfoam-state", sync: "wss://example.invalid", info: { host: "here", openfoam: "v2606" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ caseUrl: "automerge:c", serverUrl: "automerge:q", setup: defaultSetup(), hull: {}, now: 1 }));
  calls = [];
  awake = 0;
  released = 0;
});

/** A task document with these runs, and a context for the run named `me`. */
function context(runIds, me, { signal = new AbortController().signal } = {}) {
  const task = repo.add({ importUrl: "/x/daemon/run-task.mjs", input: { run: run.url }, key: run.url, runs: runIds.map((id) => ({ id, pool: "p", start: 0 })) });
  const said = { progress: [], logs: [] };
  return { said, ctx: { repo, taskUrl: task.url, run: me, key: run.url, signal, log: (m) => said.logs.push(m), progress: (p) => said.progress.push(p) } };
}

/** findWhenThere with no wait between tries. */
const findNow = (r, url) => findWhenThere(r, url, { tries: 3, sleep: async () => {} });

function task(runJob, { machine = async () => MACHINE, find = findNow } = {}) {
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

describe("the guard", () => {
  it("the first run solves", async () => {
    const { ctx } = context(["r1"], "r1");
    const out = await task(async ({ handle }) => {
      handle.change((d) => (d.status = "done"));
      return "done";
    })({ run: run.url }, ctx);
    expect(out).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handle: run, cores: 4, workDir: "/tmp/openfoam-state/runs", daemon: MACHINE.info, signal: ctx.signal, env: MACHINE.env });
  });
  it("a run after another never solves: the run doc says it was interrupted, and the task fails", async () => {
    run.change((d) => {
      d.status = "solving";
      d.stages[1].status = "running";
    });
    const { ctx } = context(["r0", "r1"], "r1");
    await expect(task(async () => "done")({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect(calls).toHaveLength(0);
    expect([run.doc().status, run.doc().error, run.doc().stages[1].status]).toEqual(["failed", NOT_RESTARTED, "failed"]);
  });
  it("a run doc that already says its machine stopped keeps saying so", async () => {
    run.change((d) => markStopped(d, "stopping", 5));
    const { ctx } = context(["r0", "r1"], "r1");
    await expect(task(async () => "done")({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect(calls).toHaveLength(0);
    expect([run.doc().status, run.doc().error]).toEqual(["failed", MACHINE_STOPPED]);
  });
  it("a run that can't find itself in its task doesn't start", async () => {
    const { ctx } = context(["r0"], "r9");
    await expect(task(async () => "done")({ run: run.url }, ctx)).rejects.toThrow(/not started/);
    expect(calls).toHaveLength(0);
    expect(run.doc().status).toBe("queued");
  });
});

describe("how a run ends", () => {
  it("a solver failure fails the task once, with the run doc's error", async () => {
    const { ctx } = context(["r1"], "r1");
    const t = task(async ({ handle }) => {
      handle.change((d) => {
        d.status = "failed";
        d.error = "snappyHexMesh failed (exit 1)";
      });
      return "failed";
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow("snappyHexMesh failed (exit 1)");
    expect(calls).toHaveLength(1);
  });
  it("told to stop: lets go of sleep at once, and throws (what it says after an abort isn't counted)", async () => {
    for (const reason of ["cancelled", "stopping", "yielded"]) {
      const abort = new AbortController();
      const { ctx } = context(["r1"], "r1", { signal: abort.signal });
      const before = released;
      let releasedAtAbort = null;
      const t = task(
        ({ signal }) =>
          new Promise((resolve) =>
            signal.addEventListener("abort", () => {
              releasedAtAbort = released - before;
              resolve("stopped");
            }),
          ),
      );
      const going = t({ run: run.url }, ctx);
      await new Promise((r) => setTimeout(r, 10));
      abort.abort(reason);
      await expect(going).rejects.toThrow(`stopped (${reason})`);
      expect(calls.at(-1).signal).toBe(abort.signal);
      // the abort's own listener let go before runJob's did anything
      expect(releasedAtAbort).toBe(1);
    }
    expect(awake).toBe(3);
  });
  it("a runJob that throws fails the run doc as well as the task", async () => {
    const { ctx } = context(["r1"], "r1");
    const t = task(async () => {
      throw new Error("the run's setup can't be read");
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow("the run's setup can't be read");
    expect([run.doc().status, run.doc().error]).toEqual(["failed", "the run's setup can't be read"]);
  });
  it("OpenFOAM that won't start fails the run doc and the task, and runs nothing", async () => {
    const { ctx } = context(["r1"], "r1");
    const t = task(async () => "done", {
      machine: async () => {
        throw new Error("OpenFOAM didn't start on here (via fake): check its launcher or bashrc.");
      },
    });
    await expect(t({ run: run.url }, ctx)).rejects.toThrow(/OpenFOAM didn't start/);
    expect(calls).toHaveLength(0);
    expect([run.doc().status, run.doc().error]).toEqual(["failed", "OpenFOAM didn't start on here (via fake): check its launcher or bashrc."]);
  });
  it("refuses an input that names no run", async () => {
    const { ctx } = context(["r1"], "r1");
    await expect(task(async () => "done")({}, ctx)).rejects.toThrow(/names no run/);
    await expect(task(async () => "done")({ run: "automerge:nothing-here" }, ctx)).rejects.toThrow(/unavailable/);
  });
  it("waits for a run doc that reaches the machine after its task", async () => {
    const { ctx } = context(["r1"], "r1");
    let asked = 0;
    const late = { find: async (url) => (++asked < 3 ? Promise.reject(new Error(`Document ${url} is unavailable`)) : repo.find(url)) };
    const out = await task(async () => "done")({ run: run.url }, { ...ctx, repo: Object.assign(Object.create(repo), late) });
    expect([out, asked, calls.length]).toEqual([{ status: "done" }, 4, 1]);
  });
});

describe("what a task view is told", () => {
  it("the status, the stage and the iteration as the run doc has them, and a log line per stage", async () => {
    const { ctx, said } = context(["r1"], "r1");
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
        d.status = "solving";
        d.progress.iteration = 40;
      });
      handle.change((d) => (d.status = "done"));
      return "done";
    })({ run: run.url }, ctx);
    expect(said.progress.map((p) => `${p.status}|${p.stage}|${p.iteration}`)).toEqual(["queued|null|0", "meshing|Write the case|0", "meshing|Hull features|0", "solving|Hull features|40", "done|Hull features|40"]);
    expect(said.logs).toEqual(["Write the case", "Hull features", "done"]);
    expect(progressOf(run.doc())).toEqual({ status: "done", stage: "Hull features", iteration: 40, of: run.doc().progress.of });
  });
});
