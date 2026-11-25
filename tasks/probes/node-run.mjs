// Tasks on machines with no browser, through the real sync server: the Node
// host (src/node/host.ts, built by `pnpm build:node`) serving a new queue,
// asked for work by a separate peer the way a tool in someone's browser would
// ask. The work is a task that runs a process (probes/solve-task.mjs), and
// its code is where a browser would find it: in this package as published,
// named by a service worker URL. The hosts have no copy of it but what they
// fetch from automerge.
//
//   (in tasks/) node probes/node-run.mjs <automerge:package url> [--sync wss://…] [--verbose]
//
// What it checks is what a solver's daemon needs of the framework: a host
// fetches a task's code, neighbours and all, from the package it accepts;
// what the process prints is heard while it runs; stopping the task kills the
// process; code from anywhere else, a data: URL included, is not run by a
// host that wasn't told to; a host told to run any code runs it; a second
// machine on the queue shares the work; and when one machine dies, the other
// finishes what it had.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo-node";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const [pkg] = process.argv.slice(2);
if (!/^automerge:\w+$/.test(pkg ?? "")) {
  console.error("usage: node probes/node-run.mjs <automerge:package url> [--sync wss://…] [--verbose]");
  process.exit(2);
}
// where the task's code is, as a browser on some site would write it: the hosts are on no site at all
const SOLVE = `https://patchwork.example/${encodeURIComponent(pkg)}/probes/solve-task.mjs`;
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
// --latency N: instead of the checks, ask one host for N tasks that do nothing, one at a time, and say how long each took
const LATENCY = arg("--latency") ? Number(arg("--latency")) : 0;
const { ask, cancel, run, watch } = await import(join(ROOT, "dist-node/job-client.mjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
const until = async (test, ms, what, every = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`${what}: not after ${ms / 1000} s`);
    await sleep(every);
  }
};
let failed = false;
const checks = {};
const check = (name, ok, detail) => {
  checks[name] = !!ok;
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// each host keeps the code it fetches in a directory of its own, empty to begin with
const CODE = mkdtempSync(join(tmpdir(), "tasks-node-probe-"));
const hosts = [];
function startHost(label, queueUrl, accept, workers = 2) {
  const child = spawn(process.execPath, [join(ROOT, "dist-node/host.mjs"), "--queue", queueUrl, ...accept, "--code-dir", join(CODE, label), "--workers", String(workers), "--sync", SYNC, ...(VERBOSE ? ["--verbose"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (c) => (out.push(String(c)), VERBOSE && process.stderr.write(`[${label}] ${c}`)));
  const host = { label, child, out };
  hosts.push(host);
  return host;
}
const stopAll = () => {
  hosts.forEach((h) => h.child.kill("SIGKILL"));
  rmSync(CODE, { recursive: true, force: true });
};
process.on("exit", stopAll);

const report = {};
let code = 1;
try {
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const queue = repo.create({ "@patchwork": { type: "task-queue-next" }, title: "node probe queue", activeRouter: null, pending: [], done: [], doneSet: {}, jobs: {} });
  await repo.flush?.();
  await sleep(3000);
  const Q = queue.url;
  report.queue = Q;

  // who the router says is working for the queue, as it says it
  let heartbeat = null;
  queue.on("ephemeral-message", ({ message }) => {
    if (message?.type === "router heartbeat" && message.routerUrl === queue.doc().activeRouter) heartbeat = message;
  });
  const workerDocs = async () => Promise.all((heartbeat?.workerUrls ?? []).map(async (url) => ({ url, ...(await within(20000, repo.find(url), "a worker's doc")).doc() })));

  // ── one machine ──
  const t0 = Date.now();
  const a = startHost("A", Q, LATENCY ? ["--accept-any"] : ["--accept", pkg]);
  await until(() => queue.doc().activeRouter, 60000, "a router for the queue");
  await until(() => (heartbeat?.workerUrls?.length ?? 0) >= 2, 30000, "host A's two workers");
  report.upSeconds = (Date.now() - t0) / 1000;
  const aWorkers = await workerDocs();
  const aUrls = new Set(aWorkers.map((w) => w.url));

  if (LATENCY) {
    // One clock (the asker and the host are this machine), but two peers: every doc and every message
    // between them goes by the sync server. From asking to the run starting, the run itself, and from
    // the run's end to the asker having the result.
    const timed = async (importUrl, input, count, tag) => {
      const rows = [];
      for (let i = 0; i < count; i++) {
        const asked = Date.now();
        let last;
        await within(120000, run(repo, Q, { importUrl, input, key: `${tag}-${i}` }, (job) => (last = job)), tag);
        const got = Date.now();
        const r = last.runs.at(-1);
        rows.push({ toStart: r.startTimeMillis - asked, ran: r.endTimeMillis - r.startTimeMillis, toAsker: got - r.endTimeMillis, total: got - asked });
      }
      return rows;
    };
    const summary = (rows) => {
      const of = (k) => {
        const v = rows.map((r) => r[k]).sort((x, y) => x - y);
        return { median: v[Math.floor(v.length / 2)], p90: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))], min: v[0], max: v.at(-1) };
      };
      return { n: rows.length, toStart: of("toStart"), ran: of("ran"), toAsker: of("toAsker"), total: of("total") };
    };
    const noop = "data:text/javascript," + encodeURIComponent("export default async function (x) { return x; }");
    await timed(noop, 1, 3, "warm-up");
    const fromPackage = await timed(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`, { ms: 0 }, LATENCY, "package");
    report.latency = { throughServer: summary(await timed(noop, 1, LATENCY, "noop")), packageFirst: fromPackage[0], packageAfter: summary(fromPackage.slice(1)) };
    console.log(JSON.stringify(report.latency, null, 1));
    stopAll();
    process.exit(0);
  }
  check("the host's workers say whose code they run from the queue: this package's", aWorkers.length === 2 && aWorkers.every((w) => JSON.stringify(w.accepts) === JSON.stringify({ [Q]: [pkg] })), aWorkers.map((w) => w.accepts));

  // a job, watched as it runs
  const seen = [];
  const first = await within(90000, run(repo, Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 300, tag: "first" }, key: "solve-1" }, (job) => seen.push({ state: job.state, step: job.progress?.step, logs: job.logs.length })), "the first task");
  const steps = [...new Set(seen.filter((s) => s.state === "running" && s.step > 0).map((s) => s.step))];
  report.first = { result: first, stepsSeenWhileRunning: steps };
  check("a host fetches the task's code from the package, its neighbour too, and runs it", first?.exitCode === 0 && first.lines === 6 && first.last === "step 6 of 6" && first.input === "first" && first.said === "finished after 6 lines", first);
  check("what the process prints is heard while it runs", steps.length >= 3 && seen.some((s) => s.state === "running" && s.logs > 0), { steps });
  // what it fetched, and that it was only what the task needed: the directory the code is in
  const fetched = readdirSync(join(CODE, "A"), { recursive: true }).map(String).filter((f) => /\.(mjs|js|json)$/.test(f)).map((f) => f.split("/").slice(2).join("/")).sort();
  report.fetched = fetched;
  check("it fetched the directory the code is in, and nothing else of the package", fetched.includes("probes/solve-task.mjs") && fetched.includes("probes/solve-task-lib.mjs") && fetched.every((f) => f.startsWith("probes/") || f === "package.json"), fetched);

  // stopping a job kills its process
  let pid = null;
  let over = null;
  const stopped = new Promise((r) => (over = r));
  const unwatch = watch(repo, Q, "solve-stop", (job) => {
    if (job.state === "running" && job.progress?.pid) pid = job.progress.pid;
    if (job.state === "cancelled") over(job);
  });
  await ask(repo, Q, { importUrl: SOLVE, input: { steps: 600, stepMs: 200 }, key: "solve-stop" });
  await until(() => pid, 30000, "the long job's process");
  const wasAlive = alive(pid);
  const tStop = Date.now();
  await cancel(repo, Q, "solve-stop");
  const stoppedJob = await within(20000, stopped, "the stopped job");
  await until(() => !alive(pid), 5000, "the process to be gone").catch(() => {});
  unwatch();
  report.stop = { pid, wasAlive, goneAfterMs: Date.now() - tStop, runs: stoppedJob.runs.map((r) => r.status) };
  check("stopping a task kills its process", wasAlive && !alive(pid) && stoppedJob.runs.at(-1)?.status === "cancelled", report.stop);

  // code from anywhere but the package isn't run by a host that wasn't told to
  const inline = "data:text/javascript," + encodeURIComponent("import { hostname } from 'node:os'; export default async function (n) { return { doubled: n * 2, on: hostname().length > 0 }; }");
  await ask(repo, Q, { importUrl: inline, input: 21, key: "inline" });
  const unkeyed = repo.create({ input: null, importUrl: inline, runs: [] });
  queue.change((d) => d.pending.push(unkeyed.url));
  const after = await within(60000, run(repo, Q, { importUrl: SOLVE, input: { steps: 2, stepMs: 100, tag: "after" }, key: "solve-after" }), "a task asked for behind them");
  await sleep(4000);
  const inlineTask = (await repo.find(queue.doc().jobs.inline.taskUrl)).doc();
  report.notAccepted = { keyedRuns: inlineTask.runs.length, keyedDone: !!queue.doc().jobs.inline.done, unkeyedRuns: unkeyed.doc().runs.length, unkeyedStillPending: queue.doc().pending.includes(unkeyed.url) };
  check("code that isn't in the package it accepts is left alone, by key or not, and holds nothing up", inlineTask.runs.length === 0 && !queue.doc().jobs.inline.done && unkeyed.doc().runs.length === 0 && queue.doc().pending.includes(unkeyed.url) && after?.input === "after", report.notAccepted);

  // ── a second machine ──
  // B is told to run any code: it takes what A left, and shares the rest
  const b = startHost("B", Q, ["--accept-any"]);
  await until(() => (heartbeat?.workerUrls?.length ?? 0) >= 4, 60000, "host B's two workers");
  const inlineResult = await within(60000, run(repo, Q, { importUrl: inline, input: 21, key: "inline" }), "the data: task, once a host runs any code");
  await until(() => unkeyed.doc().runs.length > 0, 30000, "the task on the pending list");
  report.accepted = { inlineResult, unkeyed: unkeyed.doc().runs.map((r) => r.status + ":" + JSON.stringify(r.result)) };
  check("a host told to run any code runs them: a data: URL is the code, here too", inlineResult?.doubled === 42 && inlineResult.on === true && unkeyed.doc().runs.length === 1 && unkeyed.doc().runs[0].status === "succeeded", report.accepted);
  const bUrls = new Set((await workerDocs()).map((w) => w.url).filter((url) => !aUrls.has(url)));
  const whose = (url) => (aUrls.has(url) ? "A" : bUrls.has(url) ? "B" : "?");

  // four jobs at once on four workers, then one machine dies with two of them
  const keys = ["a", "b", "c", "d"].map((k) => `long-${k}`);
  const views = Object.fromEntries(keys.map((k) => [k, null]));
  const unwatchAll = keys.map((k) => watch(repo, Q, k, (job) => (views[k] = job)));
  const tLong = Date.now();
  const results = keys.map((key) => run(repo, Q, { importUrl: SOLVE, input: { steps: 12, stepMs: 400, tag: key }, key }));
  results.forEach((p) => p.catch(() => {}));
  const taskOf = (k) => views[k]?.taskUrl;
  const runningOn = async () => {
    const out = {};
    for (const k of keys) {
      const t = taskOf(k) && (await repo.find(taskOf(k))).doc();
      out[k] = t?.current ? whose(t.current.workerUrl) : null;
    }
    return out;
  };
  const spread = await until(async () => {
    const on = await runningOn();
    return Object.values(on).every(Boolean) ? on : null;
  }, 30000, "all four jobs running");
  report.spread = spread;
  check("two machines on one queue share its tasks", Object.values(spread).filter((h) => h === "A").length === 2 && Object.values(spread).filter((h) => h === "B").length === 2, spread);

  const routerBefore = queue.doc().activeRouter;
  a.saidBeforeKill = a.out.length;
  a.child.kill("SIGKILL"); // no goodbye: the machine is simply gone
  const tKill = Date.now();
  const done = await within(120000, Promise.all(results), "the four jobs, one machine down");
  report.afterKill = { seconds: (Date.now() - tKill) / 1000, totalSeconds: (Date.now() - tLong) / 1000, routerChanged: queue.doc().activeRouter !== routerBefore };
  const finishedBy = {};
  for (const k of keys) {
    const t = (await repo.find(taskOf(k))).doc();
    finishedBy[k] = { was: spread[k], by: whose(t.runs.findLast((r) => r.status === "succeeded")?.workerUrl), runs: t.runs.length };
  }
  report.finishedBy = finishedBy;
  check("when a machine dies, the other finishes what it had", done.every((r, i) => r?.exitCode === 0 && r.input === keys[i]) && Object.values(finishedBy).every((f) => f.by === "B"), { finishedBy, afterKill: report.afterKill });
  unwatchAll.forEach((stop) => stop());

  // A task is over when its own doc says so, which is what an asker waits for. Its queue's word that
  // the key is finished with is a second change to another doc, for routers, and follows a moment later.
  const left = () => Object.entries(queue.doc().jobs).filter(([, j]) => !j.done).map(([k]) => k);
  const tLeft = Date.now();
  await until(() => left().length === 0, 15000, "every key marked finished").catch(() => {});
  report.keysFinishedAfterMs = Date.now() - tLeft;
  check("nothing asked for by key is left unfinished", left().length === 0, left());
  // (what a killed host's processes print as they find their parent gone isn't the host's doing)
  const errors = hosts.flatMap((h) => h.out.slice(0, h.saidBeforeKill ?? h.out.length).join("").split("\n").filter((l) => /error|crashed/i.test(l)).map((l) => `[${h.label}] ${l.slice(0, 300)}`));
  check("the hosts logged no errors", errors.length === 0, errors.slice(0, 8));
  code = failed ? 1 : 0;
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
  if (!VERBOSE) for (const h of hosts) console.error(`[${h.label}] ${h.out.join("").slice(-1500)}`);
}
console.log(JSON.stringify({ ...report, checks }, null, 2));
stopAll();
process.exit(code);
