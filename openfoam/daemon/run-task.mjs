// One OpenFOAM run, as a task's code. A case asks its task queue for a run
// (src/run-tasks.js); a tasks host on a machine with OpenFOAM serves the
// queue (daemon/start.sh) and calls this module's default export with the
// task's input, `{ run: <the run doc's url> }`, and its context.
//
// It finds the run doc and runs it (runner.mjs): the run doc is where the
// run's progress and results go, as the case tool shows them. What a generic
// task view shows is a small echo of it: `ctx.progress` with the status, the
// stage and the iteration, and `ctx.log` at each stage.
//
// Never solved twice unasked. Runs are long, and a task runs at least once,
// not exactly once: if its machine stops mid-run, the task is taken again.
// So a run whose task lists a run before this one does not solve: it marks
// the run doc failed (NOT_RESTARTED) and throws, and the task ends failed.
// (On a queue one machine serves, an earlier run can only be its own lost one.)
//
// Stopping. `ctx.signal` aborts with a reason: `cancelled` (someone cancelled
// the run), `stopping` (the host is shutting down) or `yielded` (another run
// has the task). Each kills the command and every process under it at once;
// the run doc then says cancelled, says the machine stopped, or (yielded)
// gets nothing more. The host ends this thread GRACE_MS after the abort.
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
import { foamEnvironment, foamVersion, defaultCores } from "./foam.mjs";
import { runJob as realRunJob } from "./runner.mjs";
import { freshPeer } from "../src/segments.js";
import { RUN_TYPE, isTerminal, markInterrupted, NOT_RESTARTED } from "../src/protocol.js";

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com";
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

const stamp = () => new Date().toTimeString().slice(0, 8);

/** Marks a run doc failed with `error`, unless it already says how it ended. */
function fail(handle, error) {
  handle.change((d) => {
    if (isTerminal(d.status)) return;
    d.status = "failed";
    d.error = error;
    d.finishedAt = Date.now();
    for (const s of d.stages ?? []) if (s.status === "running") s.status = "failed";
  });
}

/** What a generic task view is told: the run doc's status, the stage it is on, its iteration. */
export function progressOf(run) {
  const stage = run?.stages?.find((s) => s.status === "running") ?? null;
  return { status: run?.status ?? null, stage: stage?.label ?? null, iteration: run?.progress?.iteration ?? 0, of: run?.progress?.of ?? null };
}

/**
 * The task's code, made from what it needs (tests hand it fakes).
 * @param {object} o
 * @param {typeof realRunJob} o.runJob
 * @param {() => Promise<{ env: object, cores: number, state: string, sync: string, info: object }>} o.machine
 * @param {() => () => void} o.awake        holds sleep off; returns how to let go
 * @param {(sync: string) => { verify: Function, close: () => Promise<void> }} o.peer
 * @param {(message: string) => void} [o.say]  the host's log
 */
export function makeRunTask({ runJob, machine, awake, peer, say = (m) => console.log(`${stamp()} ${m}`) }) {
  return async function runTask(input, ctx) {
    const runUrl = input?.run;
    if (typeof runUrl !== "string" || !runUrl.startsWith("automerge:")) throw new Error("The task names no run: its input is { run: <an OpenFOAM run's url> }.");
    const handle = await ctx.repo.find(runUrl);
    if (handle.doc()?.["@patchwork"]?.type !== RUN_TYPE) throw new Error(`${runUrl} isn't an OpenFOAM run.`);

    // the guard: a run before this one means this run was interrupted once already
    const task = (await ctx.repo.find(ctx.taskUrl)).doc();
    const at = task?.runs?.findIndex((r) => r.id === ctx.run) ?? -1;
    if (at < 0) throw new Error("This run isn't in its task's document, so whether it ran before can't be told; it was not started.");
    if (at > 0) {
      handle.change((d) => markInterrupted(d, Date.now()));
      ctx.log("interrupted before: not started again");
      throw new Error(NOT_RESTARTED);
    }

    let facts;
    try {
      facts = await machine();
    } catch (err) {
      fail(handle, String(err?.message ?? err));
      throw err;
    }

    // the echo for a generic task view
    let last = "";
    let lastStage = null;
    const echo = () => {
      const p = progressOf(handle.doc());
      const key = JSON.stringify(p);
      if (key === last) return;
      last = key;
      ctx.progress(p);
      if (p.stage && p.stage !== lastStage) ctx.log(p.stage);
      lastStage = p.stage;
    };
    handle.on("change", echo);
    echo();

    const release = awake();
    ctx.signal.addEventListener("abort", release, { once: true });
    const checker = peer(facts.sync);
    say(`run ${runUrl}: ${handle.doc().title ?? ""}`);
    let status;
    try {
      status = await runJob({ repo: ctx.repo, handle, env: facts.env, workDir: join(facts.state, "runs"), cores: facts.cores, daemon: facts.info, say, signal: ctx.signal, verify: checker.verify });
    } catch (err) {
      // runJob records its own failures; this is one it threw instead, which the run doc says too
      if (!ctx.signal.aborted) fail(handle, String(err?.message ?? err));
      throw err;
    } finally {
      handle.off("change", echo);
      ctx.signal.removeEventListener("abort", release);
      release();
      await checker.close().catch(() => {});
    }
    if (ctx.signal.aborted || status === "stopped") throw new Error(`stopped (${ctx.signal.reason ?? "stopping"})`);
    if (status !== "done") throw new Error(handle.doc().error ?? `the run ${status}`);
    ctx.log("done");
    return { status };
  };
}

export default makeRunTask({ runJob: realRunJob, machine: thisMachine, awake: stayAwake, peer: checkerPeer });
