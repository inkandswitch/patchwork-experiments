// What of the run's task code is this package's own, with a fake repo, a
// fake runner (no solver) and a stand-in for the Tasks package's client: the
// code is that client's makeRunTask, from the pool's registry, made of this
// package's own; the runner handed the client, this machine's gmsh and
// CalculiX, cores, mesh cap and directories, with a second peer it closes
// after; the machine read from the environment; and the echo a task view is
// told. The rest (the guard, stopping, a run doc that arrives late, each way
// a run ends) is makeRunTask's, tested in the Tasks package; probes/net-run.mjs
// runs this code on a real tasks host.
import { describe, it, expect, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import runTask, { solve, machineSettings, thisMachine, progressOf, RUN_TASK } from "./run-task.mjs";
import { FakeRepo } from "../src/test/fake-repo.js";
import { standIn } from "../src/test/tasks-stand-in.js";
import { newRun, RUN_TYPE } from "../src/protocol.js";
import { normalizeSetup } from "../src/setup.js";

let repo, run, tasks;
const MACHINE = { tools: { gmsh: "/x/gmsh", ccx: "/x/ccx", gmshVersion: "4.15", ccxVersion: "2.23" }, cores: 4, maxNodes: 100_000, state: "/tmp/fea-state", sync: "wss://example.invalid", info: { host: "here", calculix: "2.23", gmsh: "4.15" } };

beforeEach(() => {
  repo = new FakeRepo();
  run = repo.add(newRun({ studyUrl: "automerge:s", serverUrl: "automerge:q", setup: normalizeSetup(null), part: {}, now: 1 }));
  tasks = standIn();
});

/** The runner as makeRunTask calls it, with a fake runner and second peer. */
const job = (o) => solve({ tasks, ...o })({ repo, handle: run, facts: MACHINE, signal: new AbortController().signal, say: () => {} });

describe("the task's code", () => {
  it("is makeRunTask from the pool's registry, made of this package's own", async () => {
    getRegistry("patchwork:library").register({ type: "patchwork:library", id: "tasks-next", load: async () => tasks });
    const ctx = { repo };
    const r = await runTask({ run: run.url }, ctx);
    expect(r.input).toEqual({ run: run.url });
    expect(r.ctx).toBe(ctx);
    expect(r.made).toMatchObject({ ...RUN_TASK, type: RUN_TYPE, what: "an FEA run", progressOf });
    expect(typeof r.made.runJob).toBe("function");
  });
  it("told to stop, gives its runner its program's kill and a little over, inside the host's grace of five seconds", () => {
    expect(RUN_TASK.stopWait).toBeLessThan(5_000);
  });
});

describe("the runner", () => {
  it("is handed the client, this machine's tools, cores, mesh cap and directories, and a second peer that is closed when it ends", async () => {
    const calls = [];
    const peers = [];
    let closed = 0;
    const verify = async () => [];
    const peer = (sync, find) => {
      peers.push([sync, find]);
      return { verify, close: async () => void closed++ };
    };
    expect(await job({ runJob: async (o) => (calls.push(o), "done"), peer })).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handle: run, tasks, tools: MACHINE.tools, cores: 4, maxNodes: 100_000, workDir: "/tmp/fea-state/runs", daemon: MACHINE.info, verify });
    expect(peers).toEqual([[MACHINE.sync, tasks.findWhenThere]]);
    expect(closed).toBe(1);
  });
  it("closes its peer when the runner throws too", async () => {
    let closed = 0;
    await expect(job({ runJob: async () => Promise.reject(new Error("*ERROR in e_c3d: nonpositive jacobian")), peer: () => ({ verify: null, close: async () => void closed++ }) })).rejects.toThrow("nonpositive jacobian");
    expect(closed).toBe(1);
  });
});

describe("the machine, from the environment", () => {
  it("reads its settings from the environment, with the defaults", () => {
    expect(machineSettings({})).toMatchObject({ gmsh: undefined, ccx: undefined, maxNodes: 250_000, state: join(homedir(), ".patchwork-fea"), sync: "wss://subduction.sync.inkandswitch.com" });
    expect(machineSettings({ GMSH: "/g", CCX: "/c", FEA_CORES: "3", FEA_MAX_NODES: "5000", FEA_STATE: "/s", PATCHWORK_SYNC: "wss://x" })).toEqual({ gmsh: "/g", ccx: "/c", cores: 3, maxNodes: 5000, state: "/s", sync: "wss://x" });
    // a cap below a thousand nodes is a slip
    expect(machineSettings({ FEA_MAX_NODES: "10" }).maxNodes).toBe(1000);
  });
  it("gmsh missing, CalculiX missing, or either not starting: a sentence saying which, on which machine", () => {
    expect(() => thisMachine({ GMSH: "/no/such/gmsh" })).toThrow(/^The machine serving this queue \(.+\) can't run it: no gmsh at \/no\/such\/gmsh\.$/);
    expect(() => thisMachine({ GMSH: "/usr/bin/false", CCX: "/no/such/ccx" })).toThrow(/can't run it: no ccx at \/no\/such\/ccx\.$/);
    expect(() => thisMachine({ GMSH: "/usr/bin/false", CCX: "/usr/bin/false" })).toThrow(/can't run it: gmsh at \/usr\/bin\/false didn't start\.$/);
  });
});

describe("what a task view is told", () => {
  it("the status and the stage the run doc has running", () => {
    const doc = run.doc();
    expect(progressOf(doc)).toEqual({ status: "queued", stage: null });
    doc.status = "solving";
    doc.stages[3].status = "running";
    expect(progressOf(doc)).toEqual({ status: "solving", stage: "Solve (CalculiX)" });
    expect(progressOf(null)).toEqual({ status: null, stage: null });
  });
});
