// @vitest-environment node
// What of the run's task code is this package's own, with a fake repo and a
// fake runner (no solver): the runner handed this machine's OpenFOAM, cores
// and directories with a second peer it closes after, the echo a task view
// is told, and the task code made from them. The rest (the guard, stopping,
// a run doc that arrives late, each way a run ends) is the kit's makeRunTask,
// tested in the tasks package (src/task-runs.test.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { solve, progressOf } from "./run-task.mjs";
import { FakeRepo } from "../probes/fake-repo.js";
import { newRun, markInterrupted, RUN_TYPE } from "../src/protocol.js";
import { defaultSetup } from "../src/setup.js";
import { makeRunTask, findWhenThere, NOT_RESTARTED } from "../src/task-runs.js";

let repo, run;
const MACHINE = { env: { describe: "fake" }, cores: 4, state: "/tmp/openfoam-state", sync: "wss://example.invalid", info: { host: "here", openfoam: "v2606" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ caseUrl: "automerge:c", serverUrl: "automerge:q", setup: defaultSetup(), hull: {}, now: 1 }));
});

/** A task document with these records, and a context for the run named `me`. */
function context(runs, me) {
  const task = repo.add({ importUrl: "/x/daemon/run-task.mjs", input: { run: run.url }, key: run.url, runs });
  const said = { progress: [], logs: [] };
  return { said, ctx: { repo, taskUrl: task.url, run: me, key: run.url, signal: new AbortController().signal, log: (m) => said.logs.push(m), progress: (p) => said.progress.push(p) } };
}

/** This package's task code, as the default export makes it, with a fake runner and machine. */
const task = (runJob, more = {}) =>
  makeRunTask({ type: RUN_TYPE, what: "an OpenFOAM run", machine: async () => MACHINE, runJob, progressOf, interrupted: markInterrupted, say: () => {}, find: (r, url) => findWhenThere(r, url, { tries: 2, sleep: async () => {} }), ...more });

describe("the runner", () => {
  it("is handed this machine's OpenFOAM, cores and directories, and a second peer that is closed when it ends", async () => {
    const calls = [];
    let closed = 0;
    const verify = async () => [];
    const { ctx } = context([{ id: "r1", pool: "p", start: 0 }], "r1");
    const runJob = solve({
      runJob: async (o) => {
        calls.push(o);
        o.handle.change((d) => (d.status = "done"));
        return "done";
      },
      peer: (sync) => ({ sync, verify, close: async () => void closed++ }),
    });
    expect(await task(runJob)({ run: run.url }, ctx)).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handle: run, env: MACHINE.env, cores: 4, workDir: "/tmp/openfoam-state/runs", daemon: MACHINE.info, signal: ctx.signal, verify });
    expect(closed).toBe(1);
  });
  it("closes its peer when the runner throws too", async () => {
    let closed = 0;
    const { ctx } = context([{ id: "r1", pool: "p", start: 0 }], "r1");
    const runJob = solve({ runJob: async () => Promise.reject(new Error("snappyHexMesh failed (exit 1)")), peer: () => ({ verify: null, close: async () => void closed++ }) });
    await expect(task(runJob)({ run: run.url }, ctx)).rejects.toThrow("snappyHexMesh failed");
    expect([closed, run.doc().status, run.doc().error]).toEqual([1, "failed", "snappyHexMesh failed (exit 1)"]);
  });
  it("refuses a run doc of another package's", async () => {
    const { ctx } = context([{ id: "r1", pool: "p", start: 0 }], "r1");
    const other = repo.add({ "@patchwork": { type: "fea-run" } });
    await expect(task(async () => "done")({ run: other.url }, ctx)).rejects.toThrow(/isn't an OpenFOAM run/);
  });
  it("an interrupted run that had finished while keeping its volume keeps its status and says the volume wasn't kept", async () => {
    run.change((d) => {
      d.status = "done";
      d.volume = { status: "posting" };
      d.stages.push({ id: "volume", status: "running" });
    });
    const { ctx } = context([{ id: "r0", pool: "p", start: 0, end: 1, status: "lost" }, { id: "r1", pool: "p", start: 0 }], "r1");
    await expect(task(async () => "done")({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
    expect([run.doc().status, run.doc().volume.status, run.doc().stages.at(-1).status]).toEqual(["done", "failed", "failed"]);
  });
});

describe("what a task view is told", () => {
  it("the status, the stage and the iteration as the run doc has them, and a log line per stage", async () => {
    const { ctx, said } = context([{ id: "r1", pool: "p", start: 0 }], "r1");
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
