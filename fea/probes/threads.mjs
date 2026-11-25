// Is this CalculiX right when it runs on several threads? One small static
// job, solved again and again under each way of sharing the cores out, each
// answer set against the single-threaded one.
//
//   node probes/threads.mjs [--reps 30] [--threads 8]
//
// Why it exists: on 2026-11-24, on an M4, a ccx 2.23 built with SPOOLES'
// multithreaded solver (-DUSE_MT, as Homebrew's formula and CalculiX's own
// Makefile_MT build it) gave a wrong answer in 9 runs of 30 with the solver
// on 8 threads: displacements off by up to 98%, and no error. With the solver
// on one thread and the rest of ccx on 8: 0 of 30. So a run always runs
// the solver on one thread (daemon/runner.mjs), daemon/install-calculix.sh
// builds the serial solver only, and every static run is checked for adding
// up (its strain energy against its loads' work).
//
// Run this on a new machine or a new ccx before trusting more threads there.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { box } from "../src/test/shapes.js";
import { readFrd } from "../src/solver/frd.js";
import { localRun, faceFacing, tools } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const reps = Number(args.reps ?? 30), threads = String(args.threads ?? 8);

const r = await localRun({
  title: "threads",
  triangles: box(0.1, 0.01, 0.01),
  cores: 1,
  setup: (part) => ({
    mesh: { size: "medium", order: 2 },
    supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] } },
    loads: { a: { name: "Tip", kind: "force", faces: [faceFacing(part, [1, 0, 0])], magnitude: { value: 100, unit: "N" }, direction: [0, -1, 0] } },
  }),
});
if (r.run.status !== "done") throw new Error(`the job to repeat ${r.run.status}: ${r.run.error}`);
const { ccx, ccxVersion } = tools();
const N = r.run.mesh.nodes;
const solve = (env) => {
  execFileSync(ccx, ["-i", "job"], { cwd: r.dir, stdio: "ignore", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  return readFrd(readFileSync(`${r.dir}/job.frd`, "utf8"), N).find((b) => b.name === "DISP").values;
};
const ref = solve({ OMP_NUM_THREADS: "1", CCX_NPROC_EQUATION_SOLVER: "1" });
const off = (a) => {
  let m = 0, s = 0;
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i] - ref[i]));
    s = Math.max(s, Math.abs(ref[i]));
  }
  return m / s;
};
console.log(`ccx ${ccxVersion} at ${ccx}: ${N} nodes, ${reps} runs each`);
const rows = [];
for (const [name, env] of Object.entries({
  [`everything on ${threads}`]: { OMP_NUM_THREADS: threads },
  [`solver on 1, the rest on ${threads} (what a run does)`]: { OMP_NUM_THREADS: threads, CCX_NPROC_EQUATION_SOLVER: "1" },
  [`solver on ${threads}, the rest on 1`]: { OMP_NUM_THREADS: "1", CCX_NPROC_EQUATION_SOLVER: threads },
})) {
  let wrong = 0, worst = 0;
  const t0 = Date.now();
  for (let i = 0; i < reps; i++) {
    const d = off(solve(env));
    worst = Math.max(worst, d);
    if (d > 1e-6) wrong++;
  }
  rows.push({ threads: name, wrong: `${wrong} of ${reps}`, "worst off": worst.toExponential(1), "ms a run": Math.round((Date.now() - t0) / reps) });
}
console.table(rows);
process.exit(rows[1].wrong.startsWith("0 ") ? 0 : 1);
