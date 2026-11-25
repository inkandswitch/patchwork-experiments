// The whole arrangement on this machine, through the real sync server: a
// tasks host serving a new queue (started by daemon/start.sh, running this
// package's daemon/run-task.mjs from this directory on this machine's
// OpenFOAM), and this process as the case tool (its own repo, nothing shared
// with the host but the server) asking for runs and following them.
//
//   TASKS_HOST=…/tasks/dist-node/host.mjs node probes/net-run.mjs
//       [--sync wss://…] [--state dir] [--cores 4] [--only served,run,finish,cancel,error,stop] [--keep]
//
// Checks, on the coarse double body of naval's narrow-transom hull:
//   served  the host is heard serving the queue while it is up, and not one
//           lapse after it stops
//   run     a case runs end to end: the run doc done with its figures and
//           layers, its task succeeded once
//   finish  finish now: the solver writes what it has and the run is done
//   cancel  cancel mid-solve: the run doc says cancelled, the task is
//           cancelled, and no solver process is left
//   error   a solver error (an STL OpenFOAM can't read) fails the run and its
//           task once, and nothing runs it again
//   stop    SIGTERM to the host mid-run: the run doc says the machine stopped
//           and the run is recorded lost; started again on the same state,
//           the host takes the task again and its code fails it without a
//           second solve
//
// --state is the host's state directory (a new one under the system's temp
// directory unless given; removed at the end unless --keep). The package url
// the runs' tasks name is made up: the host is given this directory for it.

import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { glbTriangles } from "../src/hull/mesh-read.js";
import { prepareHull } from "../src/hull/prepare.js";
import { defaultSetup, normalizeSetup } from "../src/setup.js";
import { newRun, requestFinish, isTerminal, decodeLayer, MACHINE_STOPPED, NOT_RESTARTED } from "../src/protocol.js";
import { askRun, cancelRun, setPackageUrl, hearServing } from "../src/run-tasks.js";
import { served } from "../src/task-client.js";
import { taskState, allHeard, LAPSE_MS } from "../src/task-rules.js";
import { internalize } from "../src/segments.js";
import { findWhenThere } from "../src/find.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const TASKS_HOST = resolve(process.env.TASKS_HOST ?? join(PKG, "../tasks/dist-node/host.mjs"));
if (!existsSync(TASKS_HOST)) throw new Error(`no tasks host at ${TASKS_HOST}: set TASKS_HOST`);
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const STATE = resolve(args.state ?? mkdtempSync(join(tmpdir(), "openfoam-net-")));
const CORES = String(args.cores ?? 4);
const PACKAGE = "automerge:openfoamProbePackage";
const NAME = "openfoam net probe";
const ONLY = new Set(String(args.only ?? "served,run,finish,cancel,error,stop").split(","));

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const say = (m) => console.log(`${at()} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${at()} ${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  ${JSON.stringify(detail)?.slice(0, 600)}`}`);
};
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${ms / 1000} s waiting for ${what}`);
    await sleep(250);
  }
}

// ---------------------------------------------------------------- the host

const FOAM = /Foam|mpirun|prterun|snappyHexMesh|blockMesh|surfaceFeatureExtract|checkMesh|decomposePar|mapFields/;
/** OpenFOAM's processes on this machine, with their command lines. */
function foamProcesses() {
  return execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && FOAM.test(l) && !/ps -A|net-run\.mjs|vitest/.test(l));
}

function startHost(queueArgs) {
  const child = spawn("bash", [join(PKG, "daemon/start.sh"), ...queueArgs, "--state", STATE, "--name", NAME, "--cores", CORES, "--sync", SYNC], {
    env: { ...process.env, TASKS_HOST, OPENFOAM_PACKAGE: PACKAGE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let found;
  const queue = new Promise((ok) => (found = ok));
  const take = (chunk) => {
    for (const l of chunk.toString().split("\n")) {
      if (!l.trim()) continue;
      console.log(`        host | ${l}`);
      const m = l.match(/made the queue "[^"]*": (automerge:\S+)/) ?? l.match(/^\s*queue (automerge:\S+)/);
      if (m) found(m[1]);
    }
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const exited = new Promise((ok) => child.on("exit", (code, signal) => ok({ code, signal })));
  return { child, queue, exited };
}

// ---------------------------------------------------------------- the asker

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
setPackageUrl(PACKAGE);
const glb = readFileSync(join(PKG, "../naval/src/test/fixtures/camber/narrow-transom.glb"));
const { triangles } = glbTriangles(glb);
const prep = prepareHull(triangles, {});

let queueUrl;
/** Makes a run doc and asks the queue for it, as the case tool does. */
async function ask(title, setupPatch = {}, hull = { stl: prep.stl, info: prep.info, warnings: prep.warnings }) {
  const setup = normalizeSetup({ ...defaultSetup(), mode: "double-body", mesh: "coarse", speed: { value: 6, unit: "kn" }, stop: "iterations", iterations: 2000, ...setupPatch });
  const run = await repo.create2(newRun({ caseUrl: "automerge:net-probe", serverUrl: queueUrl, setup, hull: { ...hull, source: { title: "narrow-transom.glb" } }, by: "net probe", now: Date.now(), title: `net probe · ${title}` }));
  const taskUrl = await askRun(repo, queueUrl, run);
  await repo.flush?.();
  say(`asked for "${title}": run ${run.url}, task ${taskUrl}`);
  let last = "";
  run.on("change", () => {
    const d = run.doc();
    const stage = d.stages?.find((s) => s.status === "running")?.id ?? "";
    const line = `${d.status} ${stage}`;
    if (line !== last) say(`  ${title}: ${d.status.padEnd(9)} ${stage.padEnd(20)} it ${d.progress?.iteration}`);
    last = line;
  });
  return { run, taskUrl };
}
const taskDoc = async (url) => (await repo.find(url)).doc();
/** The task, once its first `n` runs have each been completed. */
const taskWhen = (url, n, ms, what) =>
  until(async () => {
    const doc = await taskDoc(url);
    return doc?.runs?.length >= n && doc.runs.slice(0, n).every((r) => r.status) && doc;
  }, ms, what);
const ended = (d) => isTerminal(d.status) && (d.status !== "done" || !!d.summary);

const host = startHost(["--new-queue", "openfoam net probe"]);
queueUrl = await Promise.race([host.queue, host.exited.then((e) => Promise.reject(new Error(`the host exited: ${JSON.stringify(e)}`)))]);
say(`queue ${queueUrl}, host pid ${host.child.pid}, state ${STATE}`);
// a queue just made reaches the sync server a moment after its link is printed
await findWhenThere(repo, queueUrl, { tries: 20 });
let current = host;

// who is heard serving the queue, all along
let pools = [];
let emptySince = null;
served(repo, queueUrl, (list) => {
  pools = list;
  emptySince = list.length ? null : Date.now();
  say(`  served: ${list.length ? list.map((p) => `${p.name} (${p.busy}/${p.slots} busy)`).join(", ") : "nobody"}`);
});

try {
  if (ONLY.has("served")) {
    const heard = await hearServing(repo, queueUrl, 15_000);
    check("served: the host is heard serving the queue while it is up", heard.some((p) => p.name === NAME), heard);
  }

  if (ONLY.has("run")) {
    const { run, taskUrl } = await ask("end to end", { iterations: 150 });
    const d = await until(() => ended(run.doc()) && run.doc(), 900_000, "the run to end");
    let layers = 0;
    for (const url of Object.values(d.layers ?? {})) if (decodeLayer(await internalize(repo, (await findWhenThere(repo, url)).doc()))?.positions?.length) layers++;
    check("run: a case runs end to end (done, R_T, every layer readable here)", d.status === "done" && d.summary?.Rt > 0 && layers > 0 && layers === Object.keys(d.layers).length, { status: d.status, error: d.error, Rt: d.summary?.Rt, layers });
    const t = await taskWhen(taskUrl, 1, 30_000, "the task to end");
    check("run: its task succeeded, once, with a small result", taskState(t, allHeard) === "succeeded" && t.runs.length === 1 && t.runs[0].result?.status === "done", t.runs);
    say(`  Rt ${d.summary?.Rt?.toFixed(1)} N in ${d.summary?.iterations} iterations; ${d.daemon?.host}, OpenFOAM ${d.daemon?.openfoam}, ${d.daemon?.cores} cores`);
  }

  if (ONLY.has("finish")) {
    const { run } = await ask("finish now");
    await until(() => run.doc().status === "solving" && run.doc().progress.iteration >= 30, 600_000, "solving past iteration 30");
    run.change((d) => requestFinish(d));
    say("  asked to finish now");
    const d = await until(() => ended(run.doc()) && run.doc(), 300_000, "the run to end");
    check("finish: finish now keeps what it has (done, stopped as asked, before the 2000)", d.status === "done" && d.summary?.stoppedBy === "asked" && d.summary.iterations < 2000, { status: d.status, error: d.error, summary: d.summary && { stoppedBy: d.summary.stoppedBy, iterations: d.summary.iterations } });
  }

  if (ONLY.has("cancel")) {
    const { run, taskUrl } = await ask("cancel");
    await until(() => run.doc().status === "solving" && run.doc().progress.iteration >= 20, 600_000, "solving past iteration 20");
    const before = foamProcesses();
    const asked = Date.now();
    const ok = await cancelRun(repo, run.doc(), run.url);
    say(`  cancelled (${ok}); OpenFOAM processes then: ${before.length}`);
    const d = await until(() => isTerminal(run.doc().status) && run.doc(), 60_000, "the run doc to say how it ended");
    const gone = await until(() => foamProcesses().length === 0, 15_000, "OpenFOAM's processes to go").catch(() => false);
    const goneAfter = (Date.now() - asked) / 1000;
    check("cancel: the run doc says cancelled", d.status === "cancelled", { status: d.status, error: d.error });
    check("cancel: no solver process is left", before.length > 0 && gone, { before, after: foamProcesses(), seconds: goneAfter });
    const t = await taskWhen(taskUrl, 1, 30_000, "the task's run to end");
    // the run its pool stopped, then the stop that was asked for (a record with no pool)
    check("cancel: the task is cancelled: its run, then the stop", taskState(t, allHeard) === "cancelled" && t.runs.length === 2 && !!t.runs[0].pool && t.runs[0].status === "cancelled" && t.runs[1].pool === undefined && t.runs[1].status === "cancelled", t.runs);
    say(`  processes gone ${goneAfter.toFixed(1)} s after the cancel`);
  }

  if (ONLY.has("error")) {
    const bad = new TextEncoder().encode("solid nonsense\n  this is not an STL a solver can read\nendsolid\n");
    const { run, taskUrl } = await ask("solver error", {}, { stl: bad, info: prep.info, warnings: [] });
    const d = await until(() => isTerminal(run.doc().status) && run.doc(), 300_000, "the run to end");
    check("error: the run doc says failed, with the solver's error", d.status === "failed" && /failed/.test(d.error ?? ""), { status: d.status, error: d.error?.slice(0, 300) });
    await sleep(8_000); // time for a second run, were there to be one
    const t = await taskDoc(taskUrl);
    check("error: the task failed once, and nothing ran it again", taskState(t, allHeard) === "failed" && t.runs.length === 1 && t.runs[0].status === "failed", t.runs);
  }

  if (ONLY.has("stop")) {
    const { run, taskUrl } = await ask("host stopped");
    await until(() => run.doc().status === "solving" && run.doc().progress.iteration >= 10, 600_000, "solving past iteration 10");
    const startedAt = run.doc().startedAt;
    say("  SIGTERM to the host");
    current.child.kill("SIGTERM");
    const exit = await current.exited;
    say(`  the host exited ${JSON.stringify(exit)}`);
    const d = await until(() => isTerminal(run.doc().status) && run.doc(), 30_000, "the run doc to say the machine stopped");
    check("stop: the run doc says the machine stopped", d.status === "failed" && d.error === MACHINE_STOPPED, { status: d.status, error: d.error });
    const lost = await taskWhen(taskUrl, 1, 30_000, "the run to be recorded");
    check("stop: its run is recorded lost (to be taken again)", lost.runs.length === 1 && lost.runs[0].status === "lost", lost.runs);
    check("stop: no solver process is left", foamProcesses().length === 0, foamProcesses());
    say("  starting the host again on the same state");
    current = startHost(["--queue", queueUrl]);
    const t = await taskWhen(taskUrl, 2, 120_000, "the task to be taken again and end");
    check("stop: taken again, the task fails without a second solve", taskState(t, allHeard) === "failed" && t.runs[0].status === "lost" && t.runs[1].status === "failed" && (t.runs[1].logs ?? []).some((l) => /interrupted/.test(l.message)), t.runs);
    const after = run.doc();
    check("stop: the run doc still says the machine stopped, and its solve never started again", after.status === "failed" && after.error === MACHINE_STOPPED && after.startedAt === startedAt, { status: after.status, error: after.error, startedAt: [startedAt, after.startedAt] });
    say(`  (for a run doc that hadn't said how it ended, the guard writes: ${NOT_RESTARTED})`);
  }

  if (ONLY.has("served")) {
    // heard afresh, so that what lapses below is this host's last word
    const heard = await hearServing(repo, queueUrl, 15_000);
    check("served: the host serving the queue now is heard", heard.some((p) => p.name === NAME), heard);
    await until(() => pools.some((p) => p.name === NAME), 15_000, "the host to be heard");
    say("  SIGTERM to the host, to hear it go");
    const stopped = Date.now();
    current.child.kill("SIGTERM");
    await current.exited;
    await until(() => !pools.length, LAPSE_MS + 10_000, "nobody to be heard").catch(() => null);
    const after = emptySince === null ? null : (emptySince - stopped) / 1000;
    check(`served: nobody is heard one lapse (${LAPSE_MS / 1000} s) after the host stops`, after !== null && after <= LAPSE_MS / 1000 + 3, { seconds: after, pools });
    current = null;
  }
} catch (err) {
  check("the probe ran to its end", false, String(err?.stack ?? err));
} finally {
  if (current) {
    current.child.kill("SIGTERM");
    await Promise.race([current.exited, sleep(15_000)]);
  }
  await repo.flush?.().catch(() => {});
  if (!args.keep) rmSync(STATE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((r) => r.name).join("; ")}` : ""} (${at().trim()})`);
process.exit(failed.length ? 1 : 0);
