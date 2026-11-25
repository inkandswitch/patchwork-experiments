// A task for probes/node-run.mjs: what a package with a solver would publish,
// with a stand-in for the solver. The shape is the one a solver's run has:
// start a process, pass on what it prints as it goes, kill it when the run is
// told to stop, and give back how it ended. A Node host imports it from its
// local copy of the package (--local), or from the package as published (see
// src/node/package-files.ts), neighbour and all.
//
// With `guard`, it also keeps openfoam's and fea's promise never to run behind
// anyone's back: it reads the task through its Repo, and if an earlier run of
// the task is there (the machine stopped or died while running it), it
// refuses, so that the task ends failed rather than running twice.
import { spawn } from "node:child_process";
import { describeEnd } from "./solve-task-lib.mjs";

const SOLVER = `
const [steps, stepMs] = process.argv.slice(1).map(Number);
let i = 0;
const tick = () => {
  if (i >= steps) process.exit(0);
  console.log("step " + ++i + " of " + steps);
  setTimeout(tick, stepMs);
};
tick();
`;

export default async function solve(input, { log, progress, signal, repo, taskUrl, run }) {
  if (input?.guard) {
    const runs = (await repo.find(taskUrl)).doc().runs;
    const at = runs.findIndex((it) => it.id === run);
    if (at < 0) {
      throw new Error("this run is not in the task's document");
    }
    if (at > 0) {
      throw new Error(`interrupted, not re-run: an earlier run of this task (${runs[0].status ?? "open"}) is in its document`);
    }
  }
  const steps = Number(input?.steps ?? 5);
  const stepMs = Number(input?.stepMs ?? 200);
  const child = spawn(process.execPath, ["-e", SOLVER, String(steps), String(stepMs)], { stdio: ["ignore", "pipe", "inherit"] });
  // what a solver's run relies on: the process goes when the run is told to stop, not GRACE_MS later
  const stop = () => child.kill("SIGKILL");
  signal.addEventListener("abort", stop);
  const lines = [];
  let rest = "";
  child.stdout.on("data", (chunk) => {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop();
    for (const line of parts) {
      lines.push(line);
      log(line);
      progress({ step: lines.length, of: steps, pid: child.pid });
    }
  });
  progress({ step: 0, of: steps, pid: child.pid });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, killedBy) => resolve(killedBy ?? code));
  });
  signal.removeEventListener("abort", stop);
  signal.throwIfAborted();
  if (exitCode !== 0) throw new Error(`the solver ended with ${exitCode}`);
  return { exitCode, lines: lines.length, last: lines.at(-1) ?? null, input: input?.tag ?? null, said: describeEnd(lines.length) };
}
