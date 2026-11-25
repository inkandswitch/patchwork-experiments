// What of the run's task code is this package's own, with a fake repo and a
// fake runner (no solver): the runner handed this machine's gmsh and
// CalculiX, cores, mesh cap and directories with a second peer it closes
// after, the machine read from the environment, and the echo a task view is
// told. The rest (the guard, stopping, a run doc that arrives late, each way
// a run ends) is the kit's makeRunTask, tested in the tasks package
// (src/task-runs.test.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { solve, machineSettings, thisMachine, progressOf } from "./run-task.mjs";
import { FakeRepo } from "../src/test/fake-repo.js";
import { newRun, RUN_TYPE } from "../src/protocol.js";
import { normalizeSetup } from "../src/setup.js";
import { makeRunTask, findWhenThere } from "../src/task-runs.js";

let repo, run;
const MACHINE = { tools: { gmsh: "/x/gmsh", ccx: "/x/ccx", gmshVersion: "4.15", ccxVersion: "2.23" }, cores: 4, maxNodes: 100_000, state: "/tmp/fea-state", sync: "wss://example.invalid", info: { host: "here", calculix: "2.23", gmsh: "4.15" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ studyUrl: "automerge:s", serverUrl: "automerge:q", setup: normalizeSetup(null), part: {}, now: 1 }));
});

/** A task document with one open run, and a context for it. */
function context() {
  const task = repo.add({ importUrl: "/x/daemon/run-task.mjs", input: { run: run.url }, key: run.url, runs: [{ id: "r1", pool: "p", start: 0 }] });
  const said = { progress: [], logs: [] };
  return { said, ctx: { repo, taskUrl: task.url, run: "r1", key: run.url, signal: new AbortController().signal, log: (m) => said.logs.push(m), progress: (p) => said.progress.push(p) } };
}

/** This package's task code, as the default export makes it, with a fake runner and machine. */
const task = (runJob) =>
  makeRunTask({ type: RUN_TYPE, what: "an FEA run", machine: () => MACHINE, runJob, progressOf, say: () => {}, find: (r, url) => findWhenThere(r, url, { tries: 2, sleep: async () => {} }) });

describe("the runner", () => {
  it("is handed this machine's tools, cores, mesh cap and directories, and a second peer that is closed when it ends", async () => {
    const calls = [];
    let closed = 0;
    const verify = async () => [];
    const { ctx } = context();
    const runJob = solve({
      runJob: async (o) => {
        calls.push(o);
        o.handle.change((d) => (d.status = "done"));
        return "done";
      },
      peer: () => ({ verify, close: async () => void closed++ }),
    });
    expect(await task(runJob)({ run: run.url }, ctx)).toEqual({ status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handle: run, tools: MACHINE.tools, cores: 4, maxNodes: 100_000, workDir: "/tmp/fea-state/runs", daemon: MACHINE.info, signal: ctx.signal, verify });
    expect(closed).toBe(1);
  });
  it("closes its peer when the runner throws too", async () => {
    let closed = 0;
    const { ctx } = context();
    const runJob = solve({ runJob: async () => Promise.reject(new Error("*ERROR in e_c3d: nonpositive jacobian")), peer: () => ({ verify: null, close: async () => void closed++ }) });
    await expect(task(runJob)({ run: run.url }, ctx)).rejects.toThrow("nonpositive jacobian");
    expect([closed, run.doc().status]).toEqual([1, "failed"]);
  });
  it("refuses a run doc of another package's", async () => {
    const { ctx } = context();
    const other = repo.add({ "@patchwork": { type: "openfoam-run" } });
    await expect(task(async () => "done")({ run: other.url }, ctx)).rejects.toThrow(/isn't an FEA run/);
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
    const { ctx, said } = context();
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
