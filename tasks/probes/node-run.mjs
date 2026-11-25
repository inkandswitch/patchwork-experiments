// Tasks on machines with no browser, through the real sync server: Node hosts
// (dist-node/host.mjs, built by `pnpm build:node`) serving a new queue, each a
// real process with a fresh data directory, asked for work by this process
// from a Repo of its own through dist-node/task-client.mjs, the way a tool on
// another machine would ask.
//
//   (in tasks/) node probes/node-run.mjs [<automerge:package url>] [--sync wss://…] [--verbose]
//
// The task code is in probes/ (solve-task.mjs, which runs a process) and in
// data: URLs. Nothing is published: without a package url the hosts are
// given this directory as their copy of a made-up package (--local), and the
// tasks name its files the way a browser names a package's. Given the url of
// this package as published, the hosts fetch it from automerge instead.
//
// Each check prints one line with what was observed.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo-node";
import { GRACE_MS, LAPSE_MS } from "../src/task-rules.js";

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
const { ask, cancel, run, watch, served } = await import(join(ROOT, "dist-node/task-client.mjs"));

// where the task's code is, as a browser on some site would name it
const SOLVE = `/${encodeURIComponent(PKG)}/probes/solve-task.mjs`;
const code = (source) => "data:text/javascript," + encodeURIComponent(source);
const NOOP = code("export default async function (x) { return x; }");
const THROWS = code("export default async function () { throw new Error('boom, on purpose'); }");
const SPIN = code("export default function () { for (;;) {} }");
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
function startHost(label, { queue, dataDir, accept = ANY, workers = 2, wait = true }) {
  const child = spawn(process.execPath, [join(ROOT, "dist-node/host.mjs"), "--queue", queue, ...accept, "--data-dir", dataDir, "--workers", String(workers), "--name", label, "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
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
  return wait ? until(() => host.pool, 30000, `host ${label} saying who it is`).then(() => host) : host;
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

  const dirA = freshDir("A");
  let A = await startHost("A", { queue: Q, dataDir: dirA });
  report.queue = Q;
  report.package = PKG;

  // 11. a second host on the same data dir
  {
    const twin = await startHost("A-twin", { queue: Q, dataDir: dirA, wait: false });
    const { code } = await within(20000, twin.exited, "the second host on A's directory");
    const said = twin.lines.map((l) => l.text).join(" ");
    check(11, "a second host on the same data dir refuses to start", code !== 0 && /another host is running/.test(said) && A.exit === null, { exit: code, said: said.slice(0, 160) });
  }

  // 1. a do-nothing task, ask to result
  {
    await within(60000, runKey(Q, { importUrl: NOOP, input: "warm" }), "the warm-up task"); // the first one starts a thread
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
    report.latency = { total: of("total"), toStart: of("toStart"), ran: of("ran"), inThread: of("inThread"), toAsker: of("toAsker") };
    check(1, "a do-nothing task, ask to result, 10 in a row", rows.every((r) => r.ok), `median ${of("total").median} ms, worst ${of("total").worst} ms (asked to taken ${of("toStart").median}, taken to ended ${of("ran").median} of which in its thread ${of("inThread").median}, ended to the asker ${of("toAsker").median}; the router's was about 520 ms)`);
  }

  // 2. logs and progress are heard while it runs, and the lines are kept with the run
  {
    const seen = [];
    const result = await within(60000, runKey(Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 300, tag: "logs" }, key: "logs" }, (v) => seen.push({ state: v.state, step: v.progress?.step, logs: v.logs.length })), "the logging task");
    const steps = [...new Set(seen.filter((s) => s.state === "running" && s.step > 0).map((s) => s.step))];
    const task = await taskOf("logs");
    const kept = task.runs[0]?.logs?.map((l) => l.message) ?? [];
    check(2, "a task's lines and progress are heard while it runs, and its run keeps the lines", result?.lines === 6 && result.said === "finished after 6 lines" && steps.length >= 3 && seen.some((s) => s.state === "running" && s.logs > 0) && kept.length === 6 && kept[5] === "step 6 of 6", { progressHeard: steps, linesHeardWhileRunning: Math.max(...seen.filter((s) => s.state === "running").map((s) => s.logs)), linesKept: kept.length });
  }

  // 3. a throwing task fails, once
  {
    const error = await within(30000, runKey(Q, { importUrl: THROWS, key: "throws" }).then(() => null, (e) => e.message), "the throwing task");
    await sleep(3000); // time for a second run, were there to be one
    const task = await taskOf("throws");
    const runs = task.runs.map((r) => r.status);
    check(3, "a throwing task ends failed, once, with its error as the last line", error === "boom, on purpose" && runs.length === 1 && runs[0] === "failed" && task.runs[0].logs.at(-1)?.message === "boom, on purpose", { error, runs });
  }

  // 4. a spin, cancelled: stopping, then cancelled; its thread is ended; the next task runs
  {
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
  {
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
  {
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
  {
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

  // 8. two hosts on one queue, kill -9 the one running a task: the other takes it after the lapse
  const dirB = freshDir("B");
  let B = await startHost("B", { queue: Q, dataDir: dirB });
  await until(() => pools.length === 2, LAPSE_MS, "both pools heard serving").catch(() => {});
  const bothHeard = pools.map((p) => p.name).sort();
  {
    const states = [];
    const asked = runKey(Q, { importUrl: SOLVE, input: { steps: 25, stepMs: 200, tag: "failover" }, key: "failover" }, (v) => states.at(-1) !== v.state && states.push(v.state));
    asked.catch(() => {});
    // the one open run left once any second claim has yielded
    const open = await until(async () => {
      const t = await taskOf("failover").catch(() => null);
      const runs = t?.runs ?? [];
      return runs.length && runs.filter((r) => !r.status).length === 1 && states.includes("running") ? runs.find((r) => !r.status) : null;
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
    if (victim === A) A = await startHost("A", { queue: Q, dataDir: dirA });
    else B = await startHost("B", { queue: Q, dataDir: dirB });
    await until(() => pools.length === 2, LAPSE_MS, "both pools heard serving again").catch(() => {});
  }

  // 9. two hosts, four tasks listed at once
  {
    const keys = ["w", "x", "y", "z"].map((k) => `four-${k}`);
    const results = await within(90000, Promise.all(keys.map((key) => runKey(Q, { importUrl: SOLVE, input: { steps: 6, stepMs: 200, tag: key }, key }))), "four tasks at once");
    const tasks = await Promise.all(keys.map((k) => taskOf(k)));
    const finals = tasks.map((t) => t.runs.filter((r) => ["succeeded", "failed", "cancelled"].includes(r.status)).length);
    const yielded = tasks.map((t) => t.runs.filter((r) => r.status === "yielded").length);
    const by = tasks.map((t) => { const r = t.runs.find((it) => it.status === "succeeded"); return r?.pool === A.pool ? "A" : r?.pool === B.pool ? "B" : "?"; });
    check(9, "two hosts, four tasks listed at once: each has exactly one final run", results.every((r, i) => r?.input === keys[i]) && finals.every((n) => n === 1), { finalRuns: finals, yieldedRuns: yielded.reduce((a, b) => a + b, 0), perTask: yielded, finishedBy: by });
  }

  // 10. served(): lists a host while it is up, and not one lapse after it stops
  {
    const tTerm = sigterm(B);
    await within(2 * GRACE_MS + 5000, B.exited, "host B to stop");
    const gone = await until(() => !pools.some((p) => p.pool === B.pool) && Date.now(), LAPSE_MS + LAPSE_MS / 4 + 5000, "B no longer served").catch(() => null);
    const goneAfter = gone ? gone - tTerm : null;
    check(10, "served() lists a host while it is up, and drops it once it has not been heard for a lapse", bothHeard.join() === "A,B" && goneAfter !== null && goneAfter <= LAPSE_MS + LAPSE_MS / 4 + 1000 && pools.some((p) => p.pool === A.pool), { whileUp: bothHeard, droppedAfterStopMs: goneAfter, stillServing: pools.map((p) => p.name) });
  }

  // 12. code a host does not accept is never taken and holds nothing up
  {
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

  stopServed();
  // what the hosts said that would worry an operator
  const worries = hosts.flatMap((h) => h.lines.filter((l) => !(l.at >= (h.killedAt ?? Infinity)) && /^pool:|crashed|Error/.test(l.text) && !/another host is running/.test(l.text)).map((l) => `[${h.label}] ${l.text.slice(0, 200)}`));
  check("–", "the hosts reported no errors", worries.length === 0, worries.slice(0, 6));
  exitCode = failed ? 1 : 0;
} catch (err) {
  check("!", "probe ran", false, String(err?.stack ?? err));
  if (!VERBOSE) for (const h of hosts) console.error(`[${h.label}] ${h.lines.slice(-15).map((l) => l.text).join("\n")}`);
}
console.log(JSON.stringify(report, null, 1));
cleanup();
process.exit(exitCode);
