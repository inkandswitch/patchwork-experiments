// One FEA run, as a task's code. A study asks its task queue for a run
// (src/task-runs.js askRun); a tasks host on a machine with gmsh and
// CalculiX serves the queue (daemon/start.sh) and calls this module's default
// export with the task's input, `{ run: <the run doc's url> }`, and its context.
//
// The kit's makeRunTask (src/task-runs.js) does what any run asked as a task
// does: finds the run doc, never starts a run twice unasked, echoes progress
// to the task's view, lets go of the machine when told to stop, and returns
// within the host's grace whatever the runner is waiting on. What is this
// package's: the run doc's type, gmsh and CalculiX on this machine, the
// runner (runner.mjs), and the echo (`progressOf`: the status and the stage).
//
// The machine, from the environment the host was started in (start.sh sets it):
//
//   GMSH              the gmsh to use (else found: daemon/tools.mjs says where)
//   CCX               the CalculiX ccx to use (else found likewise)
//   FEA_CORES        the cores each run gets (default: all but two, at most 8)
//   FEA_MAX_NODES    the largest mesh it solves (250,000 nodes)
//   FEA_STATE        where runs/<id>/ and the kept meshes (meshes/) go (~/.patchwork-fea)
//   PATCHWORK_SYNC    the sync server, for the second peer that checks docs reached it
//
// gmsh and ccx are looked for and asked their versions at the start of every
// run, so a run on a machine without them fails at once, saying which is
// missing, instead of failing at its mesh or its solve.
//
// The kept meshes (meshes/, see runner.mjs) are this machine's: a queue has
// one host, so a study's runs of one part at one size share a mesh.
//
// Per run, too: on macOS, `caffeinate` holds idle sleep off while it runs
// (a Mac that sleeps mid-run stops the solver and drops the sync); and the
// second peer, made only if the server doesn't acknowledge a doc.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, hostname, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findGmsh, findCcx, gmshVersion, ccxVersion, defaultCores, KILL_AFTER_MS } from "./tools.mjs";
import { runJob as realRunJob } from "./runner.mjs";
import { freshPeer } from "../src/segments.js";
import { makeRunTask } from "../src/task-runs.js";
import { RUN_TYPE } from "../src/protocol.js";

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com";
/** How long a runner told to stop is given to return: its program's kill, and a little over, inside the host's GRACE_MS of 5 s. */
const STOP_WAIT_MS = KILL_AFTER_MS + 500;
const HERE = dirname(fileURLToPath(import.meta.url));

/** The machine's facts, as the environment gives them. */
export function machineSettings(env = process.env) {
  return {
    gmsh: env.GMSH || undefined,
    ccx: env.CCX || undefined,
    cores: env.FEA_CORES ? Math.max(1, Number(env.FEA_CORES) | 0) : defaultCores(),
    maxNodes: env.FEA_MAX_NODES ? Math.max(1000, Number(env.FEA_MAX_NODES) | 0) : 250_000,
    state: resolve(env.FEA_STATE || join(homedir(), ".patchwork-fea")),
    sync: env.PATCHWORK_SYNC || DEFAULT_SYNC,
  };
}

/**
 * This package's code: its version, and the git commit it runs from (and
 * whether the package has changes on top), since a run's solver input is
 * written by this code. Null outside a git checkout.
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

let code = null;

/**
 * gmsh and CalculiX on this machine, found and asked their versions, with the
 * rest of the machine's facts. Throws a plain sentence when either is missing
 * or won't start.
 */
export function thisMachine(env = process.env) {
  const settings = machineSettings(env);
  const where = hostname();
  let gmsh, ccx;
  try {
    gmsh = findGmsh(settings.gmsh);
    ccx = findCcx(settings.ccx);
  } catch (err) {
    throw new Error(`The machine serving this queue (${where}) can't run it: ${err.message}.`);
  }
  const tools = { gmsh, ccx, gmshVersion: gmshVersion(gmsh), ccxVersion: ccxVersion(ccx) };
  if (!tools.gmshVersion) throw new Error(`The machine serving this queue (${where}) can't run it: gmsh at ${gmsh} didn't start.`);
  if (!tools.ccxVersion) throw new Error(`The machine serving this queue (${where}) can't run it: CalculiX at ${ccx} didn't start.`);
  code ??= codeInfo();
  return { ...settings, tools, info: { host: where, platform: `${platform()} ${arch()}`, calculix: tools.ccxVersion, gmsh: tools.gmshVersion, maxNodes: settings.maxNodes, ...code } };
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

/** What a generic task view is told: the run doc's status and the stage it is on. */
export function progressOf(run) {
  const stage = run?.stages?.find((s) => s.status === "running") ?? null;
  return { status: run?.status ?? null, stage: stage?.label ?? null };
}

/**
 * The runner as the kit's makeRunTask calls it: runner.mjs with this
 * machine's gmsh and CalculiX, cores, mesh cap and directories, and a second
 * peer of its own that is closed when the run is over.
 * @param {{ runJob?: typeof realRunJob, peer?: (sync: string) => { verify: Function, close: () => Promise<void> } }} [o]  tests hand it fakes
 */
export function solve({ runJob = realRunJob, peer = checkerPeer } = {}) {
  return async ({ repo, handle, facts, signal, say }) => {
    const checker = peer(facts.sync);
    try {
      return await runJob({ repo, handle, tools: facts.tools, workDir: join(facts.state, "runs"), cores: facts.cores, maxNodes: facts.maxNodes, daemon: facts.info, say, signal, verify: checker.verify });
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
export const RUN_TASK = Object.freeze({ type: RUN_TYPE, what: "an FEA run", machine: () => thisMachine(), runJob: solve(), progressOf, awake: stayAwake, stopWait: STOP_WAIT_MS });

export default makeRunTask(RUN_TASK);
