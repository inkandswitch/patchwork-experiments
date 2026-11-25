// One FEA run, as a task's code. A study asks its task queue for a run
// (src/run-tasks.js); a tasks host on a machine with gmsh and CalculiX
// serves the queue (daemon/start.sh) and calls this module's default export
// with the task's input, `{ run: <the run doc's url> }`, and its context.
//
// It finds the run doc and runs it (runner.mjs): the run doc is where the
// run's progress and results go, as the study shows them. What a generic
// task view shows is a small echo of it: `ctx.progress` with the status and
// the stage, and `ctx.log` at each stage.
//
// Never solved twice unasked. A task runs at least once, not exactly once:
// if its machine stops mid-run, the task is taken again. So a run whose task
// lists a run before this one (a record with a pool: a stop has none) does
// not solve: it marks the run doc failed (NOT_RESTARTED) and throws, and the
// task ends failed. On a queue one machine serves, an earlier run can only
// be its own lost one.
//
// Stopping. `ctx.signal` aborts with a reason: `cancelled` (someone cancelled
// the run), `stopping` (the host is shutting down) or `yielded` (another run
// has the task). Each kills the program running and every process under it
// at once; the run doc then says cancelled, says the machine stopped, or
// (yielded) gets nothing more. The host ends this thread GRACE_MS after the
// abort.
//
// The machine, from the environment the host was started in (start.sh sets it):
//
//   GMSH              the gmsh to use (else found: daemon/tools.mjs says where)
//   CCX               the CalculiX ccx to use (else found likewise)
//   FEAD_CORES        the cores each run gets (default: all but two, at most 8)
//   FEAD_MAX_NODES    the largest mesh it solves (250,000 nodes)
//   FEAD_STATE        where runs/<id>/ and the kept meshes (meshes/) go (~/.patchwork-fea)
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
import { findGmsh, findCcx, gmshVersion, ccxVersion, defaultCores } from "./tools.mjs";
import { runJob as realRunJob } from "./runner.mjs";
import { freshPeer } from "../src/segments.js";
import { findWhenThere } from "../src/find.js";
import { RUN_TYPE, isTerminal, markInterrupted, NOT_RESTARTED } from "../src/protocol.js";

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com";
const HERE = dirname(fileURLToPath(import.meta.url));

/** The machine's facts, as the environment gives them. */
export function machineSettings(env = process.env) {
  return {
    gmsh: env.GMSH || undefined,
    ccx: env.CCX || undefined,
    cores: env.FEAD_CORES ? Math.max(1, Number(env.FEAD_CORES) | 0) : defaultCores(),
    maxNodes: env.FEAD_MAX_NODES ? Math.max(1000, Number(env.FEAD_MAX_NODES) | 0) : 250_000,
    state: resolve(env.FEAD_STATE || join(homedir(), ".patchwork-fea")),
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

/** What a generic task view is told: the run doc's status and the stage it is on. */
export function progressOf(run) {
  const stage = run?.stages?.find((s) => s.status === "running") ?? null;
  return { status: run?.status ?? null, stage: stage?.label ?? null };
}

/**
 * The task's code, made from what it needs (tests hand it fakes).
 * @param {object} o
 * @param {typeof realRunJob} o.runJob
 * @param {() => { tools: object, cores: number, maxNodes: number, state: string, sync: string, info: object }} o.machine  throws a plain sentence when gmsh or CalculiX is missing
 * @param {() => () => void} o.awake        holds sleep off; returns how to let go
 * @param {(sync: string) => { verify: Function, close: () => Promise<void> }} o.peer
 * @param {(message: string) => void} [o.say]  the host's log
 * @param {(repo: object, url: string) => Promise<object>} [o.find]  finds the run doc, which travels apart from its task and can reach the sync server after it (src/find.js asks again for about half a minute)
 */
export function makeRunTask({ runJob, machine, awake, peer, say = (m) => console.log(`${stamp()} ${m}`), find = findWhenThere }) {
  return async function runTask(input, ctx) {
    const runUrl = input?.run;
    if (typeof runUrl !== "string" || !runUrl.startsWith("automerge:")) throw new Error("The task names no run: its input is { run: <an FEA run's url> }.");
    const handle = await find(ctx.repo, runUrl);
    if (handle.doc()?.["@patchwork"]?.type !== RUN_TYPE) throw new Error(`${runUrl} isn't an FEA run.`);

    // the guard: a run (a record with a pool) before this one means this run was interrupted once already
    const task = (await ctx.repo.find(ctx.taskUrl)).doc();
    const at = task?.runs?.findIndex((r) => r.id === ctx.run) ?? -1;
    if (at < 0) throw new Error("This run isn't in its task's document, so whether it ran before can't be told; it was not started.");
    if (task.runs.slice(0, at).some((r) => r.pool)) {
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
      status = await runJob({ repo: ctx.repo, handle, tools: facts.tools, workDir: join(facts.state, "runs"), cores: facts.cores, maxNodes: facts.maxNodes, daemon: facts.info, say, signal: ctx.signal, verify: checker.verify });
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

export default makeRunTask({ runJob: realRunJob, machine: () => thisMachine(), awake: stayAwake, peer: checkerPeer });
