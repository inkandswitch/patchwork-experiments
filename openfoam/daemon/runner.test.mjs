// @vitest-environment node
// A run told to stop by its task's signal, with a stand-in for OpenFOAM whose
// every command is a sleep: the command and everything under it is gone
// before runJob returns, and the run doc says what the reason calls for.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "./runner.mjs";
import { FakeRepo } from "../probes/fake-repo.js";
import { newRun } from "../src/protocol.js";
import { MACHINE_STOPPED } from "../src/task-runs.js";
import { prepareHull } from "../src/hull/prepare.js";
import { boxTriangles } from "../src/test/box.js";
import { normalizeSetup } from "../src/setup.js";

/** Processes whose command line has `mark` in it. */
const running = (mark) =>
  execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes(mark) && !l.includes("ps -A"))
    .map((l) => Number(l.trim().split(/\s+/)[0]));

const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function stoppedMidCommand(reason, seconds) {
  const repo = new FakeRepo();
  const prep = prepareHull(boxTriangles());
  const handle = repo.add(newRun({ caseUrl: "automerge:c", serverUrl: "automerge:q", setup: normalizeSetup({ cores: 1 }), hull: { stl: prep.stl, info: prep.info }, now: 1 }));
  const mark = `sleep ${seconds}`;
  // a shell with a child of its own, as OpenFOAM's launcher has
  const env = { describe: "sleep", argv: () => ["bash", ["-c", `${mark} & wait`]], mpirun: (np, cmd) => cmd };
  const workDir = mkdtempSync(join(tmpdir(), "openfoam-runner-test-"));
  const abort = new AbortController();
  try {
    const job = runJob({ repo, handle, env, workDir, cores: 1, daemon: { host: "test" }, signal: abort.signal });
    await until(() => running(mark).length > 0 && handle.doc().stages.some((s) => s.status === "running" && s.id !== "prepare"));
    const t0 = Date.now();
    abort.abort(reason);
    const status = await job;
    return { status, doc: handle.doc(), left: running(mark), took: Date.now() - t0 };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

describe("a run told to stop", () => {
  it("cancelled: its processes are gone, and the run doc says cancelled", async () => {
    const r = await stoppedMidCommand("cancelled", 31.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect(r.took).toBeLessThan(4500); // inside the 5 s the host gives it
    expect(r.doc.status).toBe("cancelled");
    expect(r.doc.stages.find((s) => s.id === "surfaceFeatureExtract")).toMatchObject({ status: "failed", note: "cancelled" });
  }, 15_000);
  it("stopping: its processes are gone, and the run doc says the machine stopped", async () => {
    const r = await stoppedMidCommand("stopping", 32.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect([r.doc.status, r.doc.error]).toEqual(["failed", MACHINE_STOPPED]);
  }, 15_000);
  it("yielded: its processes are gone, and nothing more is written to the run doc", async () => {
    const r = await stoppedMidCommand("yielded", 33.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect(r.doc.status).toBe("meshing");
    expect(r.doc.stages.find((s) => s.id === "surfaceFeatureExtract").status).toBe("running");
  }, 15_000);
});
