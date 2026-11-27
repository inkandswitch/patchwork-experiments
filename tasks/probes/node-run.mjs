// Tasks on machines with no browser, through the real sync server: Node hosts
// (dist-node/host.mjs, built by `pnpm build:node`) serving a new queue, each a
// real process with a fresh data directory, asked for work by this process
// from a Repo of its own through dist-node/task-client.mjs, the way a tool on
// another machine would ask.
//
//   (in tasks/) node probes/node-run.mjs [<automerge:package url>] [--only 1,16] [--sync wss://…] [--verbose]
//
// Checks 9 and 17 to 20 are about a queue two hosts serve: each task runs
// once, by the one host it prefers (the one its asker is near, or else the
// highest hash), and work that needs a label goes only to a host that has it.
// A host takes nothing until it has listened to the queue for LISTEN_MS (it
// says it has no slots until then), so the checks that time a host start
// after that.
//
// The task code is in probes/ (solve-task.mjs, which runs a process) and in
// data: URLs. Nothing is published: without a package url the hosts are
// given this directory as their copy of a made-up package (--local), and the
// tasks name its files the way a browser names a package's. Given the url of
// this package as published, the hosts fetch it from automerge instead.
//
// Checks 22 to 27 are about a host's plugin registry (--modules): scratch
// packages, made here in automerge and listed in a module-settings document
// made here, are installed on a host, and task code given as a data: URL asks
// the registry for a library plugin with the code a page writes. A package
// added, updated and removed is seen by task code asked afterwards; a thread
// started later has the registry at once; and the host restarted with its
// sync server unreachable, given a task written straight into its storage,
// fills its registry from what it kept and runs that task.
//
// Each check prints one line with what was observed. --only runs only the
// checks named (the hosts' errors are always checked).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo-node";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { BEAT_MS, GRACE_MS, HOLD_MS, LAPSE_MS, LISTEN_MS, listTask } from "../src/task-rules.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const given = process.argv.slice(2).find((a, i, all) => a.startsWith("automerge:") && all[i - 1] !== "--sync");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKG = given ?? `automerge:${Array.from({ length: 28 }, () => BASE58[Math.floor(Math.random() * 58)]).join("")}`;
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const ONLY = arg("--only")?.split(",") ?? null;
const want = (...checks) => !ONLY || checks.some((n) => ONLY.includes(String(n)));
const { ask, cancel, run, watch, served } = await import(join(ROOT, "dist-node/task-client.mjs"));

// where the task's code is, as a browser on some site would name it
const SOLVE = `/${encodeURIComponent(PKG)}/probes/solve-task.mjs`;
const code = (source) => "data:text/javascript," + encodeURIComponent(source);
const NOOP = code("export default async function (x) { return x; }");
const THROWS = code("export default async function () { throw new Error('boom, on purpose'); }");
const SPIN = code("export default function () { for (;;) {} }");
// writes a document of `size` random bytes through ctx.repo, and returns its url and SHA-256
const WRITE = code(`export default async function ({ size }, ctx) {
  const content = new Uint8Array(size);
  for (let at = 0; at < size; at += 65536) crypto.getRandomValues(content.subarray(at, Math.min(size, at + 65536)));
  const handle = ctx.repo.create({ content });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", content));
  return { url: handle.url, sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
}`);
// awaits ctx.settled, and says when it resolved, or why it rejected; then waits `holdMs`
const SETTLES = code(`export default async function ({ holdMs }, ctx) {
  try {
    await ctx.settled;
  } catch (error) {
    ctx.log(error.message);
    return { settled: false };
  }
  const at = Date.now();
  ctx.log("settled at " + at);
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  return { settled: true, at };
}`);
const MB = 1024 * 1024;
const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const LOCAL = given ? [] : ["--local", `${PKG}=${ROOT}`];
const ANY = ["--accept-any", ...LOCAL];
const PACKAGE_ONLY = given ? ["--accept", PKG] : LOCAL;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
const until = async (test, ms, what, every = 100) => {
  const t0 = Date.now();
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`${what}: not after ${ms / 1000} s`);
    await sleep(every);
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
let failed = false;
const report = {};
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  report[n] = { ok: !!ok, saw };
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : JSON.stringify(saw)}`);
};

// ── hosts ──
const DIRS = [];
const hosts = [];
const freshDir = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `tasks-probe-${label}-`));
  DIRS.push(dir);
  return dir;
};
/** Starts a host and resolves once it has said who it is. Every line it says is kept with when it was heard. */
function startHost(label, { queue, dataDir, accept = ANY, workers = 2, wait = true, has = [], extra = [] }) {
  const child = spawn(process.execPath, [join(ROOT, "dist-node/host.mjs"), "--queue", queue, ...accept, "--data-dir", dataDir, "--workers", String(workers), "--name", label, "--sync", SYNC, "--verbose", ...has.flatMap((label) => ["--has", label]), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const host = { label, child, dataDir, lines: [], pool: null, exit: null };
  host.exited = new Promise((r) => child.on("exit", (code) => ((host.exit = { code, at: Date.now() }), r(host.exit))));
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        host.lines.push({ at: Date.now(), text });
        host.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[${label}] ${text}\n`);
      }
    });
  }
  hosts.push(host);
  return wait ? until(() => host.pool, 30000, `host ${label} saying who it is`).then(() => ((host.startedAt = Date.now()), host)) : host;
}
const lineAfter = (host, re, since = 0) => host.lines.find((l) => l.at >= since && re.test(l.text));
const sigterm = (host) => (host.child.kill("SIGTERM"), Date.now());
// What a task's process prints once its host is killed outright (an EPIPE, as it finds its parent gone) is not the host's doing.
const killNine = (host) => (host.child.kill("SIGKILL"), (host.killedAt = Date.now()));
const cleanup = () => {
  for (const h of hosts) if (h.exit === null) h.child.kill("SIGKILL");
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
};
process.on("exit", cleanup);

let exitCode = 1;
try {
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const newQueue = async (title) => {
    const queue = repo.create({ "@patchwork": { type: "task-queue-next" }, title, jobs: {} });
    await repo.flush();
    return queue;
  };
  const queue = await newQueue("node probe queue");
  const Q = queue.url;
  // the last task each key named, for a key whose entry has gone
  const lastTask = {};
  const taskOf = async (key) => (await repo.find(queue.doc().jobs[key]?.taskUrl ?? lastTask[key])).doc();
  const follow = (key, onView = () => {}) => watch(repo, Q, key, (v) => ((lastTask[key] = v.taskUrl ?? lastTask[key]), onView(v)));
  // `run`, keeping note of the task the key names
  const runKey = (queueUrl, request, onView = () => {}) =>
    run(repo, queueUrl, request, (v) => (request.key && v.taskUrl && (lastTask[request.key] = v.taskUrl), onView(v)));
  const readTask = async (url) => (await repo.find(url)).doc();

  // what served() hears, all along
  let pools = [];
  const poolsSeen = [];
  const stopServed = served(repo, Q, (list) => {
    pools = list;
    poolsSeen.push({ at: Date.now(), pools: list.map((p) => p.pool) });
  });

  /**
   * Waits until the host has listened to the queue for LISTEN_MS, so that,
   * alone, it holds back for nothing: it begins to listen once it has found
   * the queue, which it does within a second of saying who it is.
   */
  const listened = (host) => sleep(Math.max(0, host.startedAt + LISTEN_MS + 1000 - Date.now()));

  const dirA = freshDir("A");
  let A = await startHost("A", { queue: Q, dataDir: dirA });
  report.queue = Q;
  report.package = PKG;

  // 11. a second host on the same data dir
  if (want(11)) {
    const twin = await startHost("A-twin", { queue: Q, dataDir: dirA, wait: false });
    const { code } = await within(20000, twin.exited, "the second host on A's directory");
    const said = twin.lines.map((l) => l.text).join(" ");
    check(11, "a second host on the same data dir refuses to start", code !== 0 && /another host is running/.test(said) && A.exit === null, { exit: code, said: said.slice(0, 160) });
  }

  // 1. a do-nothing task, ask to result
  if (want(1)) {
    // The first task starts a thread. Asked as A begins to listen, it is taken once A has listened for LISTEN_MS.
    const warmAsked = Date.now();
    let warmView;
    await within(60000, runKey(Q, { importUrl: NOOP, input: "warm" }, (v) => (warmView = v)), "the warm-up task");
    const warmToStart = warmView.runs.find((it) => it.status === "succeeded").start - warmAsked;
    const warmAfterStart = warmAsked - A.startedAt;
    await listened(A);
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const asked = Date.now();
      let last;
      const got = await within(30000, runKey(Q, { importUrl: NOOP, input: i }, (v) => (last = v)), "a do-nothing task");
      const done = Date.now();
      const r = last.runs.find((it) => it.status === "succeeded");
      // the host's own lines: when it handed the run to a thread, and when the thread said it was done
      const id = r.id.slice(0, 8);
      const handed = lineAfter(A, new RegExp(`run ${id} of .* handed`))?.at;
      const returned = lineAfter(A, new RegExp(`run ${id} returned`))?.at;
      rows.push({ ok: got === i, total: done - asked, toStart: r.start - asked, ran: r.end - r.start, toAsker: done - r.end, inThread: returned - handed });
    }
    const of = (k) => ({ median: median(rows.map((r) => r[k])), worst: Math.max(...rows.map((r) => r[k])) });
    report.latency = { total: of("total"), toStart: of("toStart"), ran: of("ran"), inThread: of("inThread"), toAsker: of("toAsker"), warmToStart, warmAfterStart };
    // A host alone, having listened, holds back for nothing: every task is taken well within HOLD_MS of its asking.
    check(1, "a do-nothing task, ask to result, 10 in a row, on a host alone that has listened: none held back", rows.every((r) => r.ok) && of("toStart").worst < HOLD_MS, `median ${of("total").median} ms, worst ${of("total").worst} ms (asked to taken ${of("toStart").median}, worst ${of("toStart").worst}; taken to ended ${of("ran").median} of which in its thread ${of("inThread").median}; ended to the asker ${of("toAsker").median}); the warm-up task, asked ${warmAfterStart} ms after A said who it is, was taken ${warmToStart} ms after its asking`);
  }

  // 16. a task listed before its document can be fetched: the pool's first
  // find of it is refused, and the pool takes it once the document arrives.
  // The asker lists the task and makes its document reachable LATE_MS later
  // (made in a Repo with no network, then imported into its own), as happens
  // when a listing reaches a pool before the document it names.
  if (want(16)) {
    await listened(A);
    const LATE_MS = 300;
    const offline = new Repo({ network: [] });
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const key = `late-${i}`;
      const made = offline.create({ importUrl: NOOP, input: `late ${i}`, key, runs: [] });
      const bytes = await offline.export(made.url);
      const listed = Date.now();
      queue.change((doc) => listTask(doc, key, { taskUrl: made.url, askedAt: listed, package: null }));
      await repo.flush([queue.documentId]);
      await sleep(LATE_MS);
      const task = repo.import(bytes, { docId: made.documentId });
      await repo.flush([task.documentId]);
      const reachable = Date.now();
      let stop = () => {};
      const view = await within(30000, new Promise((resolve) => (stop = follow(key, (v) => v.state === "succeeded" && resolve(v)))), "a task listed before its document").finally(() => stop());
      const done = Date.now();
      const r = view.runs.find((it) => it.status === "succeeded");
      rows.push({ ok: view.result === `late ${i}`, taken: r.start - listed, afterReachable: r.start - reachable, total: done - listed });
    }
    const of = (k) => ({ median: median(rows.map((r) => r[k])), worst: Math.max(...rows.map((r) => r[k])) });
    report.late = { taken: of("taken"), afterReachable: of("afterReachable"), total: of("total") };
    check(16, `a task whose document reaches the sync server ${LATE_MS} ms after its listing is taken within 1.5 s of the listing, 5 in a row`, rows.every((r) => r.ok) && of("taken").worst <= 1500, `taken ${of("taken").median} ms after its listing (worst ${of("taken").worst}), ${of("afterReachable").median} ms after its document was sent (worst ${of("afterReachable").worst}); the asker heard it succeeded ${of("total").median} ms after listing it (worst ${of("total").worst})`);
  }

  // 2. logs and progress are heard while it runs, and the lines are kept with the run
  if (want(2)) {
    const seen = [];
    const result = await within(60000, runKey(Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 300, tag: "logs" }, key: "logs" }, (v) => seen.push({ state: v.state, step: v.progress?.step, logs: v.logs.length })), "the logging task");
    const steps = [...new Set(seen.filter((s) => s.state === "running" && s.step > 0).map((s) => s.step))];
    const task = await taskOf("logs");
    const kept = task.runs[0]?.logs?.map((l) => l.message) ?? [];
    check(2, "a task's lines and progress are heard while it runs, and its run keeps the lines", result?.lines === 6 && result.said === "finished after 6 lines" && steps.length >= 3 && seen.some((s) => s.state === "running" && s.logs > 0) && kept.length === 6 && kept[5] === "step 6 of 6", { progressHeard: steps, linesHeardWhileRunning: Math.max(...seen.filter((s) => s.state === "running").map((s) => s.logs)), linesKept: kept.length });
  }

  // 3. a throwing task fails, once
  if (want(3)) {
    const error = await within(30000, runKey(Q, { importUrl: THROWS, key: "throws" }).then(() => null, (e) => e.message), "the throwing task");
    await sleep(3000); // time for a second run, were there to be one
    const task = await taskOf("throws");
    const runs = task.runs.map((r) => r.status);
    check(3, "a throwing task ends failed, once, with its error as the last line", error === "boom, on purpose" && runs.length === 1 && runs[0] === "failed" && task.runs[0].logs.at(-1)?.message === "boom, on purpose", { error, runs });
  }

  // 21. ctx.settled: a run that nothing stops is told it settled no sooner
  // than a beat after its run was recorded (its pool counts from when the
  // start was saved, which is later); a run stopped within the beat has it
  // reject, saying `cancelled`, and is never told it settled.
  if (want(21)) {
    const settled = await within(60000, runKey(Q, { importUrl: SETTLES, input: { holdMs: 0 }, key: "settles" }), "the task awaiting ctx.settled");
    const run = (await taskOf("settles")).runs.find((r) => r.status === "succeeded");
    const after = settled?.settled && run ? settled.at - run.start : null;

    const states = [];
    let ranAt = null;
    const stop = follow("settle-stop", (v) => {
      if (states.at(-1) !== v.state) states.push(v.state);
      if (v.state === "running" && ranAt === null) ranAt = Date.now();
    });
    await ask(repo, Q, { importUrl: SETTLES, input: { holdMs: 5000 }, key: "settle-stop" });
    await until(() => ranAt, 30000, "the task to stop running");
    await cancel(repo, Q, "settle-stop");
    const tCancel = Date.now();
    await until(() => states.includes("cancelled"), 20000, "the task stopped within the beat cancelled").catch(() => {});
    stop();
    const stoppedTask = await taskOf("settle-stop");
    const mine = stoppedTask.runs.find((r) => r.pool);
    const lines = mine?.logs?.map((l) => l.message) ?? [];
    const rejected = lines.some((l) => /^the run stopped before it settled \(cancelled\)$/.test(l));
    const toldSettled = lines.some((l) => /^settled at /.test(l));
    check(21, `a task awaiting ctx.settled has it resolve no sooner than BEAT_MS (${BEAT_MS} ms) after its run was recorded; one stopped within the beat has it reject, cancelled`, after !== null && after >= BEAT_MS && rejected && !toldSettled && mine?.status === "cancelled", { resolvedAfterRunRecordedMs: after, stopped: { cancelledAfterRunRecordedMs: mine ? tCancel - mine.start : null, status: mine?.status ?? null, lines, states } });
  }

  // 4. a spin, cancelled: stopping, then cancelled; its thread is ended; the next task runs
  if (want(4)) {
    const states = [];
    const stop = follow("spin", (v) => states.at(-1) !== v.state && states.push(v.state));
    await ask(repo, Q, { importUrl: SPIN, key: "spin" });
    await until(() => states.includes("running"), 30000, "the spin running");
    const handed = await until(() => lineAfter(A, /of spin handed to thread (\d+)$/), 5000, "which thread has the spin");
    const thread = /thread (\d+)$/.exec(handed.text)[1];
    const tCancel = Date.now();
    await cancel(repo, Q, "spin");
    const ended = await until(() => lineAfter(A, new RegExp(`thread ${thread} ended`), tCancel), GRACE_MS + 5000, "the spin's thread ending").catch(() => null);
    await until(() => states.includes("cancelled"), 20000, "the spin cancelled").catch(() => {});
    stop();
    const next = await within(30000, runKey(Q, { importUrl: NOOP, input: "after the spin" }), "a task after the spin").catch((e) => e.message);
    const goneAfter = ended ? ended.at - tCancel : null;
    check(4, "a spin, cancelled, reads stopping then cancelled, its thread is ended within GRACE_MS + 1 s, and the next task runs", states.join(",").includes("running,stopping,cancelled") && goneAfter !== null && goneAfter <= GRACE_MS + 1000 && next === "after the spin", { states, threadEndedAfterMs: goneAfter, next });
  }

  // 5. a task with a child process, cancelled: the code kills the child on abort
  if (want(5)) {
    let pid = null;
    const states = [];
    const stop = follow("child", (v) => {
      if (v.state === "running" && v.progress?.pid) pid = v.progress.pid;
      if (states.at(-1) !== v.state) states.push(v.state);
    });
    await ask(repo, Q, { importUrl: SOLVE, input: { steps: 600, stepMs: 200 }, key: "child" });
    await until(() => pid, 30000, "the child process");
    const wasAlive = alive(pid);
    const tCancel = Date.now();
    await cancel(repo, Q, "child");
    await until(() => !alive(pid), GRACE_MS + 1000, "the child gone").catch(() => {});
    const goneAfter = Date.now() - tCancel;
    await until(() => states.includes("cancelled"), 20000, "the child task cancelled").catch(() => {});
    stop();
    check(5, "a task with a child process, cancelled: the child is gone because the code kills it when ctx.signal aborts", wasAlive && !alive(pid) && goneAfter < GRACE_MS && states.at(-1) === "cancelled", { pid, goneAfterMs: goneAfter, states });
  }

  // 6. SIGTERM mid-run: lost, a clean exit, and a restart runs it again; the guard refuses instead
  if (want(6)) {
    const plain = runKey(Q, { importUrl: SOLVE, input: { steps: 30, stepMs: 200, tag: "sigterm" }, key: "sigterm" });
    const guarded = runKey(Q, { importUrl: SOLVE, input: { steps: 30, stepMs: 200, guard: true }, key: "guarded" });
    plain.catch(() => {});
    guarded.catch(() => {});
    await until(async () => (await taskOf("sigterm").catch(() => null))?.runs?.length && (await taskOf("guarded").catch(() => null))?.runs?.length, 30000, "both running");
    await sleep(1500);
    const tTerm = sigterm(A);
    const { code } = await within(2 * GRACE_MS + 5000, A.exited, "host A to exit");
    const tookMs = A.exit.at - tTerm;
    const recorded = await until(async () => {
      const t = await taskOf("sigterm");
      return t.runs[0]?.status ? t.runs.map((r) => r.status) : null;
    }, 15000, "the stopped run recorded").catch(() => null);
    A = await startHost("A", { queue: Q, dataDir: dirA });
    const result = await within(60000, plain, "the task after the restart").catch((e) => e.message);
    const refused = await within(60000, guarded, "the guarded task after the restart").then(() => "ran", (e) => e.message);
    const t1 = await taskOf("sigterm");
    const t2 = await taskOf("guarded");
    check(6, "SIGTERM mid-run: recorded lost, the host exits 0 in time, a restart on the same data dir runs it again, and the guarded task fails rather than run twice", code === 0 && tookMs <= 2 * GRACE_MS + 2000 && recorded?.[0] === "lost" && result?.input === "sigterm" && t1.runs.map((r) => r.status).join() === "lost,succeeded" && t2.runs.map((r) => r.status).join() === "lost,failed" && /interrupted, not re-run/.test(refused), { exit: code, exitedAfterMs: tookMs, seenBeforeRestart: recorded, plain: t1.runs.map((r) => r.status), guarded: t2.runs.map((r) => r.status), guardSaid: refused });
  }

  // 7. kill -9 mid-run, restart on the same data dir: the pool records its own dead run lost and runs it again
  if (want(7)) {
    const asked = runKey(Q, { importUrl: SOLVE, input: { steps: 20, stepMs: 200, tag: "kill9" }, key: "kill9" });
    asked.catch(() => {});
    await until(async () => (await taskOf("kill9").catch(() => null))?.runs?.length, 30000, "running");
    await sleep(1000);
    killNine(A);
    await A.exited;
    const tRestart = Date.now();
    A = await startHost("A", { queue: Q, dataDir: dirA });
    const result = await within(60000, asked, "the task after the restart").catch((e) => e.message);
    const t = await taskOf("kill9");
    check(7, "kill -9 mid-run, restart on the same data dir: the restarted pool records its dead run lost and takes the task again", result?.input === "kill9" && t.runs.map((r) => r.status).join() === "lost,succeeded" && t.runs.every((r) => r.pool === A.pool), { runs: t.runs.map((r) => `${r.pool.slice(0, 8)}:${r.status}`), restartToResultMs: Date.now() - tRestart });
  }

  // 8–10 and 17–20 share a second host, B, which alone has the label probe-b.
  if (want(8, 9, 10, 17, 18, 19, 20)) {
    const dirB = freshDir("B");
    let B = await startHost("B", { queue: Q, dataDir: dirB, has: ["probe-b"] });
    await until(() => pools.length === 2, LAPSE_MS, "both pools heard serving").catch(() => {});
    const bothHeard = pools.map((p) => p.name).sort();
    await listened(A);
    await listened(B);

    // 8. two hosts on one queue, kill -9 the one running a task: the other takes it after the lapse
    if (want(8)) {
      const states = [];
      const asked = runKey(Q, { importUrl: SOLVE, input: { steps: 25, stepMs: 200, tag: "failover" }, key: "failover" }, (v) => states.at(-1) !== v.state && states.push(v.state));
      asked.catch(() => {});
      // The one open run left once any second claim has yielded. The other
      // pool's claim can reach this process after the first one does, so a run
      // counts only once it has been the one open run for two seconds: killing
      // the pool of a run that is about to yield would test nothing.
      let candidate = null;
      let since = 0;
      const open = await until(async () => {
        const t = await taskOf("failover").catch(() => null);
        const runs = t?.runs ?? [];
        const opens = runs.filter((r) => !r.status);
        const one = opens.length === 1 && states.includes("running") ? opens[0] : null;
        if (one?.id !== candidate?.id) {
          candidate = one;
          since = Date.now();
          return null;
        }
        return one && Date.now() - since >= 2000 ? one : null;
      }, 30000, "one run holding");
      await sleep(1000);
      const victim = open.pool === A.pool ? A : B;
      const other = victim === A ? B : A;
      const tKill = killNine(victim);
      const result = await within(90000, asked, "the task after one host died").catch((e) => e.message);
      const t = await taskOf("failover");
      const dead = t.runs.find((r) => r.id === open.id);
      const finished = t.runs.find((r) => r.status === "succeeded");
      const order = ["running", "stalled", "running", "succeeded"];
      let at = 0;
      for (const s of states) if (s === order[at]) at++;
      check(8, "two hosts, kill -9 the one running it: the other takes it after the lapse and finishes; the dead run stays open; the asker saw running, stalled, running, succeeded", result?.input === "failover" && finished?.pool === other.pool && dead && !dead.status && at === order.length, { killed: victim.label, finishedBy: finished && (finished.pool === other.pool ? other.label : "?"), runs: t.runs.map((r) => `${r.pool === A.pool ? "A" : "B"}:${r.status ?? "open"}`), states, killToResultMs: Date.now() - tKill });
      // back on its own directory, so that both are up for what follows
      const back = victim === A ? (A = await startHost("A", { queue: Q, dataDir: dirA })) : (B = await startHost("B", { queue: Q, dataDir: dirB, has: ["probe-b"] }));
      await until(() => pools.length === 2, LAPSE_MS, "both pools heard serving again").catch(() => {});
      await listened(back);
    }

    const hostOf = (pool) => (pool === A.pool ? "A" : pool === B.pool ? "B" : pool ? pool.slice(0, 8) : "?");

    // 9. two hosts, four tasks listed at once: each runs once, by the host it prefers
    if (want(9)) {
      const keys = ["w", "x", "y", "z"].map((k) => `four-${k}`);
      const asked = Date.now();
      const results = await within(90000, Promise.all(keys.map((key) => runKey(Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 200, tag: key }, key }))), "four tasks at once");
      const tasks = await Promise.all(keys.map((k) => taskOf(k)));
      const runs = tasks.map((t) => t.runs.length);
      const yielded = tasks.map((t) => t.runs.filter((r) => r.status === "yielded").length);
      // each run: which host, how it went, and when it was taken and ended after the asking began (each host's clock)
      const how = tasks.map((t) => t.runs.map((r) => `${hostOf(r.pool)}:${r.status}@${r.start - asked}-${r.end - asked}`).join(" "));
      check(9, "two hosts, four tasks listed at once: each has exactly one run, and none yielded", results.every((r, i) => r?.input === keys[i]) && runs.every((n) => n === 1) && yielded.every((n) => n === 0), { runsPerTask: runs, yieldedRuns: yielded.reduce((a, b) => a + b, 0), runs: how });
    }

    // 17. work that needs a label only B has is run by B, every time, also while B's slots are full
    if (want(17)) {
      const keys = Array.from({ length: 10 }, (_, i) => `needs-b-${i}`);
      const asked = Date.now();
      const results = await within(90000, Promise.all(keys.map((key, i) => runKey(Q, { importUrl: NOOP, input: i, key, needs: ["probe-b"] }))), "ten tasks that need probe-b");
      const tasks = await Promise.all(keys.map((k) => taskOf(k)));
      const by = tasks.map((t) => t.runs.map((r) => `${hostOf(r.pool)}:${r.status}@${r.start - asked}`).join(","));
      const byB = tasks.filter((t) => t.runs.length === 1 && t.runs[0].pool === B.pool && t.runs[0].status === "succeeded").length;
      const yielded = tasks.flatMap((t) => t.runs).filter((r) => r.status === "yielded").length;
      check(17, "ten tasks listed at once that need a label only one host has: that host runs each, once", results.every((r, i) => r === i) && byB === 10, { ranByThatHostOnce: `${byB} of 10`, yieldedRuns: yielded, runs: by });
    }

    // 18. work that needs a label neither host has waits, listed and untaken, until a third host that has it starts
    if (want(18)) {
      const asked = runKey(Q, { importUrl: NOOP, input: "for C", key: "needs-c", needs: ["probe-c"] });
      asked.catch(() => {});
      await sleep(5000);
      const before = await taskOf("needs-c");
      const listedBefore = queue.doc().jobs["needs-c"]?.taskUrl === lastTask["needs-c"];
      const heardHave = pools.map((p) => `${p.name}: ${p.has.filter((l) => !l.startsWith("pool:")).join("+")}`).sort();
      const C = await startHost("C", { queue: Q, dataDir: freshDir("C18"), workers: 1, has: ["probe-c"] });
      const tStart = Date.now();
      const result = await within(60000, asked, "the task that needs probe-c").catch((e) => e.message);
      const tookMs = Date.now() - tStart;
      const after = await taskOf("needs-c");
      check(18, "a task that needs a label no host has stays listed with no run, and the host that has it, once started, runs it", before.runs.length === 0 && listedBefore && result === "for C" && after.runs.length === 1 && after.runs[0].pool === C.pool, { runsAfter5s: before.runs.length, stillListed: listedBefore, heardServing: heardHave, result, runs: after.runs.map((r) => `${r.pool === C.pool ? "C" : hostOf(r.pool)}:${r.status}`), resultAfterCSaidWhoItIsMs: tookMs });
      sigterm(C);
      await within(2 * GRACE_MS + 5000, C.exited, "host C to stop");
      // C said, stopping, that it has no slots: nobody holds back for it from here on
    }

    // 19. near: work asked near one host is run by that host, whichever the hash would prefer
    if (want(19)) {
      const rows = [];
      for (const host of [A, B, A, B, A, B]) {
        const key = `near-${rows.length}`;
        const asked = Date.now();
        await within(30000, runKey(Q, { importUrl: NOOP, input: key, key, near: host.pool }), "a task asked near a host");
        const t = await taskOf(key);
        rows.push({ near: host.label, runs: t.runs.map((r) => `${hostOf(r.pool)}:${r.status}`).join(","), started: t.runs.map((r) => r.start - asked).join(",") });
      }
      const right = rows.filter((r) => r.runs === `${r.near}:succeeded`).length;
      check(19, "a task asked near a host is run by that host, once", right === rows.length, { ranByTheHostNamed: `${right} of ${rows.length}`, rows });
    }

    // 20. four tasks asked at once near A, whose two slots then fill: A runs two at once, and B
    // the other two, at once if it heard A full before it first saw them, else HOLD_MS after
    if (want(20)) {
      const keys = ["p", "q", "r", "s"].map((k) => `near-a-${k}`);
      const asked = Date.now();
      const results = await within(90000, Promise.all(keys.map((key) => runKey(Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 200, tag: key }, key, near: A.pool }))), "four tasks near A");
      const tasks = await Promise.all(keys.map((k) => taskOf(k)));
      const how = tasks.map((t) => t.runs.map((r) => `${hostOf(r.pool)}:${r.status}@${r.start - asked}`).join(" "));
      const once = tasks.every((t) => t.runs.length === 1 && t.runs[0].status === "succeeded");
      const byA = tasks.filter((t) => t.runs[0]?.pool === A.pool).length;
      check(20, "four tasks at once near a host with two slots: it runs two, the other host two, each once, none yielded", results.every((r, i) => r?.input === keys[i]) && once && byA === 2, { runs: how });
      report.nearA = how;
    }

    // 10. served(): lists a host while it is up, and drops it as it stops, on its word that it has no slots
    if (want(10)) {
      const tTerm = sigterm(B);
      const gone = await until(() => !pools.some((p) => p.pool === B.pool) && Date.now(), LAPSE_MS + 5000, "B no longer served").catch(() => null);
      await within(2 * GRACE_MS + 5000, B.exited, "host B to stop");
      const goneAfter = gone ? gone - tTerm : null;
      check(10, "served() lists a host while it is up, and drops it within a second of its stopping (its last word says it has no slots), not a lapse later", bothHeard.join() === "A,B" && goneAfter !== null && goneAfter <= 1000 && pools.some((p) => p.pool === A.pool), { whileUp: bothHeard, droppedAfterStopMs: goneAfter, exitedAfterStopMs: B.exit.at - tTerm, stillServing: pools.map((p) => p.name) });
    }
  }

  // 12. code a host does not accept is never taken and holds nothing up
  if (want(12)) {
    const strict = await newQueue("node probe queue, packages only");
    const C = await startHost("C", { queue: strict.url, dataDir: freshDir("C"), accept: PACKAGE_ONLY });
    const inline = await ask(repo, strict.url, { importUrl: NOOP, input: 1, key: "inline" });
    const behind = await within(60000, runKey(strict.url, { importUrl: SOLVE, input: { steps: 2, stepMs: 100, tag: "behind" }, key: "behind" }), "a package task behind it").catch((e) => e.message);
    await sleep(3000);
    const t = await readTask(inline.taskUrl);
    check(12, "code a host does not accept (a data: URL, with --accept of one package) is never taken and holds nothing up", behind?.input === "behind" && t.runs.length === 0 && strict.doc().jobs.inline?.taskUrl === inline.taskUrl, { dataTaskRuns: t.runs.length, stillListed: !!strict.doc().jobs.inline, behind: behind?.input ?? behind });
    sigterm(C);
    await within(2 * GRACE_MS + 5000, C.exited, "host C to stop");
  }

  // 13–15. what a task writes can be found the moment its run reads succeeded:
  // a run worker says how a run ended only once the sync server has
  // acknowledged what it wrote, so the asker's first find is not refused,
  // even when the host is stopped at once.
  if (want(13, 14, 15)) {
    const writeRun = async (queueUrl, key) => {
      const t0 = Date.now();
      const made = await within(90000, runKey(queueUrl, { importUrl: WRITE, input: { size: MB }, key }), "the writing task");
      return { ...made, askMs: Date.now() - t0 };
    };
    /** One find, the first this Repo makes of `url`: is the document there, whole? */
    const firstFind = async ({ url, sha256: want }) => {
      const t0 = Date.now();
      try {
        const handle = await within(60000, repo.find(url), "the first find");
        const content = handle.doc()?.content;
        return { found: content?.byteLength === MB && (await sha256(content)) === want, ms: Date.now() - t0 };
      } catch (error) {
        return { found: false, refused: String(error?.message ?? error).slice(0, 80), ms: Date.now() - t0 };
      }
    };
    const runLogs = async (key) => (await taskOf(key)).runs.find((r) => r.status === "succeeded")?.logs?.map((l) => l.message) ?? [];

    const made = await writeRun(Q, "writes");
    const got = await firstFind(made);
    check(13, "a task that writes 1 MB: the asker's first find after succeeded has it", got.found, { ...got, askMs: made.askMs, runLog: await runLogs("writes") });

    // A host of its own, stopped the moment the asker reads succeeded: once
    // after a do-nothing task (its thread connected), and once with the
    // writing task as its thread's first job.
    for (const [n, warm] of [[14, true], [15, false]]) {
      const own = await newQueue(`node probe queue, stopped host ${n}`);
      const D = await startHost(`D${n}`, { queue: own.url, dataDir: freshDir(`D${n}`), workers: 1 });
      if (warm) await within(60000, runKey(own.url, { importUrl: NOOP, input: "warm" }), "the warm-up task");
      const key = `writes-then-stop-${n}`;
      const wrote = await within(90000, run(repo, own.url, { importUrl: WRITE, input: { size: MB }, key }, (v) => (lastTask[key] = v.taskUrl ?? lastTask[key])), "the writing task");
      const tTerm = sigterm(D);
      const found = await firstFind(wrote);
      const { code } = await within(2 * GRACE_MS + 5000, D.exited, `host D${n} to stop`);
      check(n, `a task that writes 1 MB on a host stopped the moment its run reads succeeded${warm ? "" : ", as its thread's first job"}: the asker's first find has it`, found.found, { ...found, hostExit: code, hostExitedAfterMs: D.exit.at - tTerm, runLog: await runLogs(key) });
    }
  }

  // 22–27. a host's plugin registry (--modules)
  if (want(22, 23, 24, 25, 26, 27)) {
    // A package kept in automerge as pushwork keeps one: a folder document
    // mapping each path to its file's document, pinned to the file's heads.
    const pin = (handle) => handle.view(handle.heads()).url;
    const publish = (files, was = null) => {
      const handles = was?.handles ?? new Map();
      for (const [path, content] of Object.entries(files)) {
        const handle = handles.get(path);
        if (!handle) handles.set(path, repo.create({ "@patchwork": { type: "file" }, content }));
        else if (handle.doc().content !== content) handle.change((d) => (d.content = content));
      }
      const root = was?.root ?? repo.create({ "@patchwork": { type: "directory" } });
      root.change((d) => {
        for (const [path, handle] of handles) if (d[path] !== pin(handle)) d[path] = pin(handle);
      });
      return { root, handles, url: root.url };
    };
    const tag = Math.random().toString(36).slice(2, 8);
    const library = (id, version) => ({
      "package.json": JSON.stringify({ name: `probe-${id}`, type: "module", main: "dist/index.js" }),
      "dist/index.js": `export const plugins = [{ type: "patchwork:library", id: ${JSON.stringify(id)}, name: "Probe library", load: () => import("./lib.js") }];\n`,
      "dist/lib.js": `export const version = ${version};\nexport const add = (a, b) => a + b;\n`,
    });
    const LIB = `probe-lib-${tag}`;
    const LATE = `probe-late-${tag}`;
    const lib = publish(library(LIB, 1));
    const settings = repo.create({ "@patchwork": { type: "patchwork:module-settings" }, modules: [lib.url] });
    await repo.flush();
    // on the sync server before a host looks: a source a watcher cannot find as it starts is skipped
    const other = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
    for (const url of [settings.url, lib.url, ...[...lib.handles.values()].map((h) => h.url)]) await within(30000, other.find(url), "a scratch package's document on the sync server");
    await other.shutdown();
    // the code a page writes, given as a data: URL: each id's library, or that there is none
    const ASKS = code(`import { getRegistry } from "@inkandswitch/patchwork-plugins";
export default async function ({ ids, holdMs = 0 }) {
  const registry = getRegistry("patchwork:library");
  const out = {};
  for (const id of ids) {
    if (!registry.has(id)) { out[id] = "none"; continue; }
    const { module } = await registry.load(id);
    out[id] = { version: module.version, sum: module.add(2, 3) };
  }
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  return out;
}`);
    const ids = [LIB, LATE];
    const mq = await newQueue("node probe queue, plugins");
    const dirM = freshDir("M");
    const M = await startHost("M", { queue: mq.url, dataDir: dirM, extra: ["--modules", settings.url] });
    const asks = (input, key) => within(60000, run(repo, mq.url, { importUrl: ASKS, input, key }), "the task that asks the registry");
    /** Waits for the host to say its registry, after `since`, as `test` wants it. */
    const said = (since, test, what) => until(() => M.lines.find((l) => l.at >= since && /plugins: /.test(l.text) && test(l.text)), 30000, what);
    const t0 = Date.now();
    await said(t0 - 60000, (text) => text.includes(LIB), "the host's registry to have the library");
    const first = await asks({ ids }, "plugins-first");
    check(22, "task code on a Node host asks the registry for a scratch package's library and gets its module", first[LIB]?.version === 1 && first[LIB]?.sum === 5 && first[LATE] === "none", { ...first, registeredInMs: M.lines.find((l) => /plugins: .*probe-lib/.test(l.text)).at - M.lines[0].at });

    const late = publish(library(LATE, 1));
    await repo.flush();
    const tAdd = Date.now();
    settings.change((d) => d.modules.push(late.url));
    await said(tAdd, (text) => text.includes(LATE), "the added package in the host's registry");
    const added = await asks({ ids }, "plugins-added");
    check(23, "a package added to the host's module settings is there for task code asked afterwards", added[LATE]?.version === 1 && added[LIB]?.version === 1, { ...added, seenInMs: M.lines.find((l) => l.at >= tAdd && l.text.includes(LATE)).at - tAdd });

    const tUpdate = Date.now();
    publish(library(LIB, 2), lib);
    await said(tUpdate, () => true, "the updated package in the host's registry");
    const updated = await asks({ ids }, "plugins-updated");
    check(24, "a package updated (new heads) gives task code asked afterwards its new module", updated[LIB]?.version === 2, { ...updated, seenInMs: M.lines.find((l) => l.at >= tUpdate && /plugins: /.test(l.text)).at - tUpdate });

    const tRemove = Date.now();
    settings.change((d) => d.modules.splice(d.modules.indexOf(late.url), 1));
    await said(tRemove, (text) => !text.includes(LATE), "the removed package gone from the host's registry");
    const removed = await asks({ ids }, "plugins-removed");
    check(25, "a package removed from the host's module settings is gone for task code asked afterwards", removed[LATE] === "none" && removed[LIB]?.version === 2, { ...removed, goneInMs: M.lines.find((l) => l.at >= tRemove && /plugins: /.test(l.text)).at - tRemove });

    // two at once on a host with two slots, one thread alive: the second starts now, and its task asks at once
    const tTwo = Date.now();
    const two = await Promise.all([asks({ ids, holdMs: 1500 }, "plugins-two-a"), asks({ ids, holdMs: 1500 }, "plugins-two-b")]);
    const newThread = M.lines.find((l) => l.at >= tTwo && /thread 1 started/.test(l.text));
    check(26, "a thread started after the registry changed has it at once", !!newThread && two.every((r) => r[LIB]?.version === 2 && r[LATE] === "none"), { started: newThread?.text.slice(25), results: two });

    // 27. no network: the host stopped, a task written straight into what it
    // keeps, and the host started again with its sync server unreachable
    sigterm(M);
    await within(2 * GRACE_MS + 5000, M.exited, "host M to stop");
    const kept = () => new Repo({ network: [], storage: new NodeFSStorageAdapter(join(dirM, "pool")) });
    const before = kept();
    const offline = await ask(before, mq.url, { importUrl: ASKS, input: { ids }, key: "plugins-offline" });
    await before.flush();
    await before.shutdown();
    const tOffline = Date.now();
    const M2 = await startHost("M-offline", { queue: mq.url, dataDir: dirM, extra: ["--modules", settings.url, "--sync", "ws://127.0.0.1:9"] });
    const ended = await until(() => M2.lines.find((l) => l.at >= tOffline && /run \w+ (returned|threw)/.test(l.text)), 60000, "the offline host to run the task");
    const filled = M2.lines.find((l) => /plugins: .*probe-lib/.test(l.text));
    sigterm(M2);
    await within(2 * GRACE_MS + 5000, M2.exited, "host M-offline to stop");
    const after = kept();
    const runs = (await within(10000, after.find(offline.taskUrl), "the offline task in the host's storage")).doc().runs;
    await after.shutdown();
    const result = runs.find((r) => r.status === "succeeded")?.result;
    check(27, "a host restarted with no network fills its registry from what it kept, and task code gets the library", result?.[LIB]?.version === 2 && result?.[LATE] === "none", { result, registeredInMs: filled ? filled.at - M2.lines[0].at : null, ran: ended.text.slice(25), runs: runs.map((r) => r.status) });
  }

  stopServed();
  // what the hosts said that would worry an operator
  const worries = hosts.flatMap((h) => h.lines.filter((l) => !(l.at >= (h.killedAt ?? Infinity)) && /^pool:|crashed|Error/.test(l.text) && !/another host is running/.test(l.text) && !/ECONNREFUSED 127\.0\.0\.1:9\b/.test(l.text)).map((l) => `[${h.label}] ${l.text.slice(0, 200)}`));
  check("–", "the hosts reported no errors", worries.length === 0, worries.slice(0, 6));
  exitCode = failed ? 1 : 0;
} catch (err) {
  check("!", "probe ran", false, String(err?.stack ?? err));
  if (!VERBOSE) for (const h of hosts) console.error(`[${h.label}] ${h.lines.slice(-15).map((l) => l.text).join("\n")}`);
}
console.log(JSON.stringify(report, null, 1));
cleanup();
process.exit(exitCode);
