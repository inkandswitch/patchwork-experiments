// The runner: what it keeps of the solver's input, how it stops when told
// to, and (where gmsh and CalculiX are installed) one real run, start to
// finish, against theory.
// Machines without the solvers skip the real run; probes/validate.mjs is the
// full set. The Tasks package's client is a stand-in (src/test/tasks-stand-in.js):
// what markStopped writes for each reason is that package's, and
// probes/net-run.mjs sees it on a real host.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deckOutline, runJob } from "./runner.mjs";
import { findGmsh, findCcx } from "./tools.mjs";
import { box } from "../src/test/shapes.js";
import { FakeRepo } from "../src/test/fake-repo.js";
import { readPart } from "../src/part/faces.js";
import { encodePart } from "../src/part/kept.js";
import { newRun } from "../src/protocol.js";
import { standIn } from "../src/test/tasks-stand-in.js";
import { normalizeSetup } from "../src/setup.js";

describe("deckOutline", () => {
  it("cuts a long list to its first lines and a count, and leaves short ones whole", () => {
    const deck = ["*HEADING", "a bar", "*NODE, NSET=NALL", ...Array.from({ length: 40 }, (_, i) => `${i + 1}, 0, 0, 0`), "*MATERIAL, NAME=M1", "*ELASTIC", "2e11, 0.3", "*STEP", "*STATIC", "*END STEP", ""].join("\n");
    const lines = deckOutline(deck, 6).split("\n");
    expect(lines.slice(0, 3)).toEqual(["*HEADING", "a bar", "*NODE, NSET=NALL"]);
    expect(lines.slice(3, 9)).toEqual(Array.from({ length: 6 }, (_, i) => `${i + 1}, 0, 0, 0`));
    expect(lines[9]).toBe("** … 34 more lines");
    expect(lines.slice(10, 13)).toEqual(["*MATERIAL, NAME=M1", "*ELASTIC", "2e11, 0.3"]);
    // every keyword line survives, in order
    expect(lines.filter((l) => l.startsWith("*") && !l.startsWith("**"))).toEqual(deck.split("\n").filter((l) => l.startsWith("*")));
  });
  it("what it adds is a comment to CalculiX", () => {
    const out = deckOutline(["*NODE", ...Array.from({ length: 30 }, (_, i) => `${i}`)].join("\n"));
    expect(out.split("\n").filter((l) => l.includes("more lines")).every((l) => l.startsWith("**"))).toBe(true);
  });
});

const solvers = (() => {
  try {
    return { gmsh: findGmsh(), ccx: findCcx() };
  } catch {
    return null;
  }
})();

describe.skipIf(!solvers)("a real run (gmsh and CalculiX are here)", () => {
  it("a steel cantilever: meshed on its own faces, solved, and right", { timeout: 120_000 }, async () => {
    const { localRun, faceFacing } = await import("../probes/lib.mjs");
    const L = 0.1, w = 0.01, P = 100, E = 200e9, nu = 0.3;
    const r = await localRun({
      tasks: standIn(),
      title: "cantilever",
      triangles: box(L, w, w),
      cores: 2,
      setup: (part) => ({
        material: { name: "Steel", E: { value: 200, unit: "GPa" }, nu, density: { value: 7850, unit: "kg/m³" }, yield: { value: 250, unit: "MPa" } },
        mesh: { size: "coarse", order: 2 },
        supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
        loads: { a: { name: "Tip", kind: "force", faces: [faceFacing(part, [1, 0, 0])], magnitude: { value: P, unit: "N" }, direction: [0, -1, 0] } },
      }),
    });
    expect(r.run.status, r.run.error ?? "").toBe("done");
    expect(r.run.stages.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(r.run.mesh.method).toBe("faces");
    const s = r.run.summary;
    const I = w ** 4 / 12, G = E / (2 * (1 + nu)), kappa = (10 * (1 + nu)) / (12 + 11 * nu);
    const theory = (P * L ** 3) / (3 * E * I) + (P * L) / (kappa * w * w * G);
    expect(Math.abs(s.displacement.max / theory - 1)).toBeLessThan(0.03);
    expect(s.reactions[0].force[1]).toBeCloseTo(P, 6);
    expect(s.balance).toBeLessThan(1e-8);
    expect(s.adrift).toBeLessThan(1e-5);
    expect(s.mass).toBeCloseTo(7850 * L * w * w, 6);
    // the results a scene draws: the skin, with stress and movement at its points
    expect(r.layer.positions.length / 3).toBeGreaterThan(100);
    expect(Object.keys(r.layer.fields).sort()).toEqual(["ux", "uy", "uz", "vm"]);
    expect(r.run.recipe.deck).toMatch(/\*STATIC/);
  });
});

// A run told to stop by its task's signal, with a stand-in for gmsh that is a
// shell with a sleeping child of its own: the program and everything under it
// is gone before runJob returns, the reason is handed to markStopped, and
// nothing more is written.
describe("a run told to stop", () => {
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

  async function stoppedMidMesh(reason, seconds) {
    const repo = new FakeRepo();
    const part = readPart(box(0.1, 0.01, 0.01));
    const kept = encodePart(part, { url: "automerge:p", title: "bar", readAt: 1 });
    const handle = repo.add(newRun({ studyUrl: "automerge:s", serverUrl: "automerge:q", setup: normalizeSetup(null), part: kept, now: 1 }));
    const dir = mkdtempSync(join(tmpdir(), "fea-runner-test-"));
    const mark = `sleep ${seconds}`;
    const fake = join(dir, "fake-gmsh.sh");
    writeFileSync(fake, `#!/bin/bash\n${mark} &\nwait\n`);
    chmodSync(fake, 0o755);
    const abort = new AbortController();
    try {
      const job = runJob({ repo, handle, tasks: standIn(), tools: { gmsh: fake, ccx: fake, gmshVersion: "fake", ccxVersion: "fake" }, workDir: join(dir, "runs"), cores: 1, maxNodes: 250_000, daemon: { host: "test" }, signal: abort.signal });
      await until(() => running(mark).length > 0 && handle.doc().stages[1].status === "running");
      const t0 = Date.now();
      abort.abort(reason);
      const status = await job;
      return { status, doc: handle.doc(), left: running(mark), took: Date.now() - t0, meshes: readdirSync(join(dir, "meshes")) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("cancelled: its processes are gone, markStopped is told why, nothing more is written, and no mesh is kept", async () => {
    const r = await stoppedMidMesh("cancelled", 41.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect(r.took).toBeLessThan(4500); // inside the 5 s the host gives it
    expect([r.doc.stopped, r.doc.status, r.doc.error]).toEqual(["cancelled", "meshing", null]);
    expect(r.doc.stages.map((s) => s.status)).toEqual(["done", "running", "pending", "pending", "pending"]);
    expect(r.meshes).toEqual([]);
  }, 15_000);
  it("stopping: its processes are gone, and markStopped is told the machine is stopping", async () => {
    const r = await stoppedMidMesh("stopping", 42.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect(r.doc.stopped).toBe("stopping");
  }, 15_000);
  it("yielded: its processes are gone, and markStopped is told it yielded", async () => {
    const r = await stoppedMidMesh("yielded", 43.25);
    expect(r.status).toBe("stopped");
    expect(r.left).toEqual([]);
    expect([r.doc.stopped, r.doc.status, r.doc.stages[1].status]).toEqual(["yielded", "meshing", "running"]);
  }, 15_000);
  it("a reason it doesn't know is the machine stopping", async () => {
    const r = await stoppedMidMesh("whatever", 44.25);
    expect([r.status, r.doc.stopped, r.left]).toEqual(["stopped", "stopping", []]);
  }, 15_000);
});
