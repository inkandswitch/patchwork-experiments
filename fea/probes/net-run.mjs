// The whole arrangement on this machine, through the real sync server: a
// tasks host serving a new queue (started by daemon/start.sh, running this
// package's daemon/run-task.mjs from this directory on this machine's gmsh
// and CalculiX), and this process as the study tool (its own repo, nothing
// shared with the host but the server) asking for runs by the same functions
// a person's clicks call (src/study-model.js) and following them.
//
//   TASKS_HOST=…/tasks/dist-node/host.mjs node probes/net-run.mjs
//       [--sync wss://…] [--state dir] [--cores 2] [--size 1.7] [--only served,run,cancel,error,stop] [--keep]
//
// Checks:
//   served  the host is heard serving the queue while it is up, and not one
//           lapse after it stops
//   run     a plate with a hole, pulled, on a coarse mesh: the run doc done
//           with its figures and its results doc readable here, its task
//           succeeded once
//   cancel  cancel mid-solve (a block meshed at --size mm, so that its solve
//           takes a while): the run doc says cancelled, the task is
//           cancelled, and no solver or mesher process is left
//   error   a run whose code fails (its load is on a face the part doesn't
//           have, asked for directly, as the study tool would refuse to)
//           fails the run and its task once, and nothing runs it again
//   stop    SIGTERM to the host mid-solve: the run doc says the machine
//           stopped and the run is recorded lost; started again on the same
//           state, the host takes the task again and its code fails it
//           without a second solve
//
// --state is the host's state directory (a new one under the system's temp
// directory unless given; removed at the end unless --keep). The package url
// the runs' tasks name is made up: the host is given this directory for it.

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { box, plateWithHole } from "../src/test/shapes.js";
import { encodeGLB } from "../src/glb.js";
import { newRun, decodeLayer, RUN_CODE } from "../src/protocol.js";
import { internalize } from "../src/segments.js";
import { normalizeSetup } from "../src/setup.js";
import * as model from "../src/study-model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const TASKS_HOST = resolve(process.env.TASKS_HOST ?? join(PKG, "../tasks/dist-node/host.mjs"));
if (!existsSync(TASKS_HOST)) throw new Error(`no tasks host at ${TASKS_HOST}: set TASKS_HOST`);
// this probe is not a pool: it has no registry, and takes the client's Node build from beside the host
const tasks = await import(pathToFileURL(join(dirname(TASKS_HOST), "task-client.mjs")).href);
const { hearServing, findWhenThere, served, isRunEnded, taskState, allHeard, LAPSE_MS, MACHINE_STOPPED, NOT_RESTARTED } = tasks;
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const STATE = resolve(args.state ?? mkdtempSync(join(tmpdir(), "fea-net-")));
const CORES = String(args.cores ?? 2);
const SLOW_SIZE = { value: Number(args.size ?? 1.7), unit: "mm" };
const PACKAGE = "automerge:feaNetProbePackage";
const NAME = "fea net probe";
const ONLY = new Set(String(args.only ?? "served,run,cancel,error,stop").split(","));

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
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`);
  return r;
};
/** A doc's value as plain objects, arrays and bytes of its own (as study-model.js freezes a part). */
function plain(v) {
  if (v instanceof Uint8Array) return Uint8Array.from(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

// ---------------------------------------------------------------- the host

/** gmsh's and CalculiX's processes on this machine, with their command lines. */
function solverProcesses() {
  return execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && /(^|\/)(gmsh|ccx(_[\d.]+)?)(\s|$)/.test(l.replace(/^\d+\s+/, "")));
}

function startHost(queueArgs) {
  const child = spawn("bash", [join(PKG, "daemon/start.sh"), ...queueArgs, "--state", STATE, "--name", NAME, "--cores", CORES, "--sync", SYNC], {
    env: { ...process.env, TASKS_HOST, FEA_PACKAGE: PACKAGE },
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
// the run's code, as the task names it: this directory is the made-up package's (the host is given it)
const code = `/${encodeURIComponent(PACKAGE)}/${RUN_CODE}`;

const SHAPES = {
  // 100 × 40 × 5 mm with an 8 mm hole, held at −x and pulled 1 kN along +x
  plate: { triangles: plateWithHole(0.1, 0.04, 0.005, 0.004, 48), hold: [-1, 0, 0], push: [1, 0, 0], force: [1, 0, 0], newtons: 1000 },
  // 30 × 50 × 20 mm, stood on its base and pressed down on its top
  block: { triangles: box(0.03, 0.05, 0.02), hold: [0, -1, 0], push: [0, 1, 0], force: [0, -1, 0], newtons: 1200 },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The face of a part whose outward normal is nearest `d`. */
const facing = (part, d) => [...part.faces].sort((a, b) => dot(b.normal, d) - dot(a.normal, d))[0].id;

let queueUrl;
/**
 * A study of a shape, set up and run as a person does it in the study tool;
 * or, with `tweak`, a run of it asked for directly with its setup changed by
 * `tweak` (to ask for what the study tool would refuse, as it would ask).
 */
async function ask(title, shape, size, { tweak = null } = {}) {
  const S = SHAPES[shape];
  const file = await repo.create2({ "@patchwork": { type: "file" }, name: `${shape}.glb`, extension: "glb", mimeType: "model/gltf-binary", content: encodeGLB({ meshes: [{ name: shape, primitives: [{ positions: Float32Array.from(S.triangles) }] }] }) });
  const study = await repo.create2(model.newStudy(`net probe · ${title}`));
  const ctx = { repo, tasks, code, handle: study, by: "net probe" };
  const part = must(await model.linkPart(ctx, file.url), "linking the part").part;
  must(model.setMesh(ctx, { size }), "the mesh");
  must(model.addSupport(ctx, part, { kind: "fixed", name: "Held", faces: [facing(part, S.hold)] }), "the support");
  must(model.addLoad(ctx, part, { kind: "force", name: "Push", faces: [facing(part, S.push)], magnitude: { value: S.newtons, unit: "N" }, direction: S.force }), "the load");
  must(await model.setServer(ctx, queueUrl), "the server");
  let run;
  if (!tweak) run = await repo.find(must(await model.runStudy(ctx), "running").url);
  else {
    const { ["@patchwork"]: _type, study: _study, ...frozen } = plain((await repo.find(study.doc().part.kept)).doc());
    frozen.title = shape;
    run = await repo.create2(newRun({ studyUrl: study.url, serverUrl: queueUrl, setup: tweak(normalizeSetup(study.doc().setup)), part: frozen, by: "net probe", now: Date.now(), title: `net probe · ${title}` }));
    await tasks.askRun(repo, queueUrl, run, code);
  }
  await repo.flush?.();
  const taskUrl = run.doc().task;
  say(`asked for "${title}": run ${run.url}, task ${taskUrl}`);
  let last = "";
  run.on("change", () => {
    const d = run.doc();
    const stage = d.stages?.find((s) => s.status === "running")?.label ?? "";
    const line = `${d.status} ${stage}`;
    if (line !== last) say(`  ${title}: ${d.status.padEnd(9)} ${stage}`);
    last = line;
  });
  return { run, taskUrl };
}
const taskDoc = async (url) => (await repo.find(url)).doc();
/** The task, once its first `n` records have each been completed. */
const taskWhen = (url, n, ms, what) =>
  until(async () => {
    const doc = await taskDoc(url);
    return doc?.runs?.length >= n && doc.runs.slice(0, n).every((r) => r.status) && doc;
  }, ms, what);
const ended = (d) => isRunEnded(d.status) && (d.status !== "done" || !!d.summary);

const host = startHost(["--new-queue", "fea net probe"]);
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
    const { run, taskUrl } = await ask("end to end", "plate", "coarse");
    const d = await until(() => ended(run.doc()) && run.doc(), 300_000, "the run to end");
    let layer = null;
    if (d.layers?.skin) layer = decodeLayer(await internalize(repo, (await findWhenThere(repo, d.layers.skin)).doc(), { find: findWhenThere }));
    check("run: a study runs end to end (done, its stress, its results readable here)", d.status === "done" && d.summary?.stress?.max > 0 && layer?.positions?.length > 0, { status: d.status, error: d.error, stress: d.summary?.stress?.max, points: layer?.positions?.length });
    check("run: its answer adds up (strain energy against the loads' work)", d.summary?.adrift != null && d.summary.adrift < 1e-3, { adrift: d.summary?.adrift });
    const t = await taskWhen(taskUrl, 1, 30_000, "the task to end");
    check("run: its task succeeded, once, with a small result", taskState(t, allHeard) === "succeeded" && t.runs.length === 1 && t.runs[0].result?.status === "done", t.runs);
    say(`  ${d.mesh?.nodes} nodes; ${d.daemon?.host}, CalculiX ${d.daemon?.calculix}, gmsh ${d.daemon?.gmsh}, ${d.daemon?.cores} cores`);
  }

  if (ONLY.has("cancel")) {
    const { run, taskUrl } = await ask("cancel", "block", SLOW_SIZE);
    await until(() => run.doc().status === "solving", 600_000, "solving");
    await sleep(1500);
    const before = solverProcesses();
    const asked = Date.now();
    const ok = await model.stopRun({ repo, tasks }, run.url);
    say(`  cancelled (${JSON.stringify(ok)}); solver processes then: ${before.length}`);
    const d = await until(() => isRunEnded(run.doc().status) && run.doc(), 60_000, "the run doc to say how it ended");
    const gone = await until(() => solverProcesses().length === 0, 15_000, "the solver's processes to go").catch(() => false);
    const goneAfter = (Date.now() - asked) / 1000;
    check("cancel: the run doc says cancelled, at the solve", d.status === "cancelled" && d.stages.find((s) => s.id === "solve")?.note === "cancelled", { status: d.status, error: d.error, stages: d.stages.map((s) => `${s.id}:${s.status}:${s.note}`) });
    check("cancel: no solver or mesher process is left", before.length > 0 && gone, { before, after: solverProcesses(), seconds: goneAfter });
    const t = await taskWhen(taskUrl, 2, 30_000, "the task's run to end");
    check("cancel: the task is cancelled (its stop and its run, each recorded cancelled)", taskState(t, allHeard) === "cancelled" && t.runs.length === 2 && t.runs.every((r) => r.status === "cancelled"), t.runs);
    say(`  processes gone ${goneAfter.toFixed(1)} s after the cancel`);
  }

  if (ONLY.has("error")) {
    const onNoFace = (setup) => {
      for (const load of Object.values(setup.loads)) load.faces = [999];
      return setup;
    };
    const { run, taskUrl } = await ask("run error", "plate", "coarse", { tweak: onNoFace });
    const d = await until(() => isRunEnded(run.doc().status) && run.doc(), 300_000, "the run to end");
    check("error: the run doc says failed, with why", d.status === "failed" && /is on no face of the mesh/.test(d.error ?? ""), { status: d.status, error: d.error?.slice(0, 300) });
    say(`  failed at ${d.stages.find((s) => s.status === "failed")?.label}: ${String(d.error).slice(0, 200)}`);
    await sleep(8_000); // time for a second run, were there to be one
    const t = await taskDoc(taskUrl);
    check("error: the task failed once, and nothing ran it again", taskState(t, allHeard) === "failed" && t.runs.length === 1 && t.runs[0].status === "failed", t.runs);
  }

  if (ONLY.has("stop")) {
    const { run, taskUrl } = await ask("host stopped", "block", SLOW_SIZE);
    await until(() => run.doc().status === "solving", 600_000, "solving");
    await sleep(1500);
    const startedAt = run.doc().startedAt;
    say("  SIGTERM to the host");
    current.child.kill("SIGTERM");
    const exit = await current.exited;
    say(`  the host exited ${JSON.stringify(exit)}`);
    const d = await until(() => isRunEnded(run.doc().status) && run.doc(), 30_000, "the run doc to say the machine stopped");
    check("stop: the run doc says the machine stopped", d.status === "failed" && d.error === MACHINE_STOPPED, { status: d.status, error: d.error });
    const lost = await taskWhen(taskUrl, 1, 30_000, "the run to be recorded");
    check("stop: its run is recorded lost (to be taken again)", lost.runs.length === 1 && lost.runs[0].status === "lost", lost.runs);
    check("stop: no solver or mesher process is left", solverProcesses().length === 0, solverProcesses());
    say("  starting the host again on the same state");
    current = startHost(["--queue", queueUrl]);
    const t = await taskWhen(taskUrl, 2, 120_000, "the task to be taken again and end");
    check("stop: taken again, the task fails without a second solve", taskState(t, allHeard) === "failed" && t.runs[0].status === "lost" && t.runs[1].status === "failed" && (t.runs[1].logs ?? []).some((l) => /interrupted/.test(l.message)), t.runs);
    const after = run.doc();
    check("stop: the run doc still says the machine stopped, and its solve never started again", after.status === "failed" && after.error === MACHINE_STOPPED && after.startedAt === startedAt && solverProcesses().length === 0, { status: after.status, error: after.error, startedAt: [startedAt, after.startedAt] });
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
