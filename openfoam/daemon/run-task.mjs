// One OpenFOAM run, as a task's code. A case asks its task queue for a run
// (src/task-runs.js askRun); a tasks host on a machine with OpenFOAM serves
// the queue (daemon/start.sh) and calls this module's default export with the
// task's input, `{ run: <the run doc's url> }`, and its context.
//
// The kit's makeRunTask (src/task-runs.js) does what any run asked as a task
// does: finds the run doc, never starts a run twice unasked, echoes progress
// to the task's view, lets go of the machine when told to stop, and returns
// within the host's grace whatever the runner is waiting on. What is this
// package's: the run doc's type, OpenFOAM on this machine, the runner
// (runner.mjs), the echo (`progressOf`: the status, the stage and the
// iteration), and what an interrupted run doc says (src/protocol.js).
// Finish-now is not a stop: it is the run doc's `control.finish`, which the
// runner watches.
//
// The machine, from the environment the host was started in (start.sh sets it):
//
//   FOAMD_LAUNCHER     the OpenFOAM launcher (macOS: found by itself)
//   FOAMD_BASHRC       or a Linux install's etc/bashrc
//   FOAMD_MPIRUN_ARGS  extra mpirun arguments
//   FOAMD_CORES        the cores each run gets (default: all but two, at most 8)
//   FOAMD_STATE        where each run's case directory is kept, under runs/ (~/.patchwork-openfoam)
//   PATCHWORK_SYNC     the sync server, for the second peer that checks docs reached it
//
// Per run, too: on macOS, `caffeinate` holds idle sleep off while it runs
// (a Mac that sleeps mid-run stops the solver and drops the sync); and the
// second peer, made only if the server doesn't acknowledge a doc.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, hostname, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { foamEnvironment, foamVersion, defaultCores, KILL_AFTER_MS } from "./foam.mjs";
import { runJob as realRunJob } from "./runner.mjs";
import { freshPeer } from "../src/segments.js";
import { makeRunTask } from "../src/task-runs.js";
import { RUN_TYPE, markInterrupted } from "../src/protocol.js";

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com";
/** How long a runner told to stop is given to return: its command's kill, and a little over, inside the host's grace of 5 s. */
const STOP_WAIT_MS = KILL_AFTER_MS + 500;
const HERE = dirname(fileURLToPath(import.meta.url));

/** The machine's facts, as the environment gives them. */
export function machineSettings(env = process.env) {
  return {
    launcher: env.FOAMD_LAUNCHER || undefined,
    bashrc: env.FOAMD_BASHRC || undefined,
    mpirunArgs: env.FOAMD_MPIRUN_ARGS ?? "",
    cores: env.FOAMD_CORES ? Math.max(1, Number(env.FOAMD_CORES) | 0) : defaultCores(),
    state: resolve(env.FOAMD_STATE || join(homedir(), ".patchwork-openfoam")),
    sync: env.PATCHWORK_SYNC || DEFAULT_SYNC,
  };
}

/**
 * This package's code: its version, and the git commit it runs from (and
 * whether the package has changes on top), since a run's case is written by
 * this code. Null outside a git checkout.
 */
function codeInfo() {
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")).version ?? null;
  } catch {
    // not beside its package.json
  }
  let commit = null;
  let dirty = null;
  try {
    const head = spawnSync("git", ["-C", HERE, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
    if (head.status === 0) {
      commit = head.stdout.trim();
      const status = spawnSync("git", ["-C", HERE, "status", "--porcelain", "--", ".."], { encoding: "utf8" });
      dirty = status.status === 0 && status.stdout.trim().length > 0;
    }
  } catch {
    // no git
  }
  return { version, commit, dirty };
}

let found = null;
/** OpenFOAM on this machine, found and started once per thread. Throws a plain sentence if it isn't there. */
async function thisMachine() {
  found ??= (async () => {
    const settings = machineSettings();
    const env = foamEnvironment(settings);
    const openfoam = await foamVersion(env);
    if (!openfoam) throw new Error(`OpenFOAM didn't start on ${hostname()} (via ${env.describe}): check its launcher or bashrc.`);
    return { ...settings, env, info: { host: hostname(), platform: `${platform()} ${arch()}`, openfoam, ...codeInfo() } };
  })();
  try {
    return await found;
  } catch (err) {
    found = null; // looked for again next run
    throw err;
  }
}

/** Holds idle sleep off while the run goes (macOS); returns how to let go. */
function stayAwake() {
  if (process.platform !== "darwin") return () => {};
  try {
    const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    child.on("error", () => {});
    return () => {
      try {
        child.kill();
      } catch {
        // gone
      }
    };
  } catch {
    return () => {};
  }
}

/** The second peer: a repo of its own on the sync server, nothing stored, made on first use. */
function checkerPeer(sync) {
  return freshPeer(async () => {
    const { Repo, initSubduction } = await import("@automerge/automerge-repo");
    await initSubduction();
    return new Repo({ network: [], subductionWebsocketEndpoints: [sync] });
  });
}

/** What a generic task view is told: the run doc's status, the stage it is on, its iteration. */
export function progressOf(run) {
  const stage = run?.stages?.find((s) => s.status === "running") ?? null;
  return { status: run?.status ?? null, stage: stage?.label ?? null, iteration: run?.progress?.iteration ?? 0, of: run?.progress?.of ?? null };
}

/**
 * The runner as the kit's makeRunTask calls it: runner.mjs with this
 * machine's OpenFOAM, cores and directories, and a second peer of its own
 * that is closed when the run is over.
 * @param {{ runJob?: typeof realRunJob, peer?: (sync: string) => { verify: Function, close: () => Promise<void> } }} [o]  tests hand it fakes
 */
export function solve({ runJob = realRunJob, peer = checkerPeer } = {}) {
  return async ({ repo, handle, facts, signal, say }) => {
    const checker = peer(facts.sync);
    try {
      return await runJob({ repo, handle, env: facts.env, workDir: join(facts.state, "runs"), cores: facts.cores, daemon: facts.info, say, signal, verify: checker.verify });
    } finally {
      await checker.close().catch(() => {});
    }
  };
}

/**
 * What this package's task code is made of. The default export is made from
 * it, and the tests make the same with a fake machine, runner and sleep in
 * their places, so what they check is what runs.
 */
export const RUN_TASK = Object.freeze({ type: RUN_TYPE, what: "an OpenFOAM run", machine: thisMachine, runJob: solve(), progressOf, interrupted: markInterrupted, awake: stayAwake, stopWait: STOP_WAIT_MS });

export default makeRunTask(RUN_TASK);
