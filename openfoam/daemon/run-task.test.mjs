// @vitest-environment node
// What of the run's task code is this package's own, with a fake repo, a
// fake runner (no solver) and a stand-in task client: the runner handed the
// client and this machine's OpenFOAM, cores and directories with a second
// peer it closes after, the echo a task view is told, what an interrupted
// run writes, and the default export asking the registry for the client and
// making its task code from them. The rest (the guard, stopping, a run doc
// that arrives late, each way a run ends) is the client's makeRunTask,
// tested in the tasks package and run against its build by probes/net-run.mjs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import runTaskCode, { solve, progressOf, runTask } from "./run-task.mjs";
import { FakeRepo } from "../probes/fake-repo.js";
import { newRun, RUN_TYPE } from "../src/protocol.js";
import { defaultSetup } from "../src/setup.js";
import { standInTasks, installTasks } from "../src/test/tasks-stand-in.js";

let repo, run, tasks;
const MACHINE = { env: { describe: "fake" }, cores: 4, state: "/tmp/openfoam-state", sync: "wss://example.invalid", info: { host: "here", openfoam: "v2606" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ caseUrl: "automerge:c", serverUrl: "automerge:q", setup: defaultSetup(), hull: {}, now: 1 }));
  tasks = standInTasks();
});
afterEach(() => getRegistry("patchwork:library").unregister("tasks-next"));

describe("the task code", () => {
  it("asks the registry for the task client and makes itself from this package's runner, echo and interruption", async () => {
    installTasks(tasks);
    const ctx = { repo };
    const r = await runTaskCode({ run: run.url }, ctx);
    expect(r.input).toEqual({ run: run.url });
    expect(r.ctx).toBe(ctx);
    expect(r.made).toMatchObject({ type: RUN_TYPE, what: "an OpenFOAM run", progressOf });
    expect(r.made.stopWait).toBeLessThan(5000); // inside the 5 s grace a host gives a stopped run
  });
  it("waits for the task client while the registry has none", async () => {
    let settled = false;
    const going = runTaskCode({ run: run.url }, { repo }).then((r) => ((settled = true), r));
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    installTasks(tasks);
    expect((await going).input).toEqual({ run: run.url });
  });
});

describe("the runner", () => {
  it("is handed the task client, this machine's OpenFOAM, cores and directories, and a second peer that is closed when it ends", async () => {
    const calls = [];
    let closed = 0;
    const verify = async () => [];
    const signal = new AbortController().signal;
    const runJob = solve({
      tasks,
      runJob: async (o) => {
        calls.push(o);
        return "done";
      },
      peer: (sync, find) => ({ sync, find, verify, close: async () => void closed++ }),
    });
    expect(await runJob({ repo, handle: run, facts: MACHINE, signal, say: () => {} })).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tasks, handle: run, env: MACHINE.env, cores: 4, workDir: "/tmp/openfoam-state/runs", daemon: MACHINE.info, signal, verify });
    expect(closed).toBe(1);
  });
  it("closes its peer when the runner throws too, and finds docs there with the task client", async () => {
    let closed = 0;
    let found = null;
    const runJob = solve({ tasks, runJob: async () => Promise.reject(new Error("snappyHexMesh failed (exit 1)")), peer: (sync, find) => ((found = find), { verify: null, close: async () => void closed++ }) });
    await expect(runJob({ repo, handle: run, facts: MACHINE, signal: null, say: () => {} })).rejects.toThrow("snappyHexMesh failed");
    expect([closed, found]).toEqual([1, tasks.findWhenThere]);
  });
});

describe("an interrupted run", () => {
  it("is the task client's to mark, unless it had finished while keeping its volume: then it keeps its status and says the volume wasn't kept", () => {
    const { interrupted } = runTask(tasks);
    run.change((d) => interrupted(d, 9));
    expect(run.doc().interrupted).toBe(true);
    const kept = repo.add({ ...newRun({ caseUrl: "automerge:c", serverUrl: "automerge:q", setup: defaultSetup(), hull: {}, now: 1 }), status: "done", volume: { status: "posting" } });
    kept.change((d) => d.stages.push({ id: "volume", status: "running" }));
    kept.change((d) => interrupted(d, 9));
    expect([kept.doc().status, kept.doc().volume.status, kept.doc().stages.at(-1).status, kept.doc().interrupted]).toEqual(["done", "failed", "failed", undefined]);
  });
});

describe("what a task view is told", () => {
  it("the status, the stage it is on and the iteration, as the run doc has them", () => {
    run.change((d) => {
      d.status = "solving";
      d.stages[0].status = "done";
      d.stages[1].status = "running";
      d.progress.iteration = 40;
    });
    expect(progressOf(run.doc())).toEqual({ status: "solving", stage: "Hull features", iteration: 40, of: run.doc().progress.of });
    expect(progressOf(null)).toEqual({ status: null, stage: null, iteration: 0, of: null });
  });
});
