// Run a published copy of this package in the REAL Patchwork, the way a
// person's browser runs it: a fresh profile (cdp.mjs) installs it from its
// automerge url through module settings, joins one new queue of its own (and
// no other: never the queue everyone shares), and hands that queue some
// tasks, on its list and by key. It then says which shared workers started
// and from which package, who became the queue's router, and how the tasks
// went: run once, heard while running, stopped, retried, and whose code the
// workers would and wouldn't run.
//
//   (in tasks/) node probes/real-run.mjs <automerge:package url> [--tasks 12] [--wait 180] [--shots dir]
//
// Nothing here is written anywhere a person would see: the account, its
// module settings and the queue all belong to the throwaway profile.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [pkg] = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!/^automerge:\w+$/.test(pkg ?? "")) {
  console.error("usage: node probes/real-run.mjs <automerge:package url> [--tasks 12] [--wait 180] [--shots dir]");
  process.exit(2);
}
const TASKS = Number(arg("--tasks", 12));
// --latency N: instead of the checks, ask for N tasks that do nothing, one at a time, and say how long each took
const LATENCY = arg("--latency") ? Number(arg("--latency")) : 0;
const WAIT = Number(arg("--wait", 180));
const SHOTS = arg("--shots") ? resolve(arg("--shots")) : null;
const CDP = Number(arg("--cdp", 9987));
const SHELL = arg("--shell", "https://patchwork.inkandswitch.com/");
const ID = pkg.slice("automerge:".length);

const b = await browser({ root: HERE, port: Number(arg("--port", 4987)), cdp: CDP, page: "/cdp.mjs", timeout: (WAIT + 150) * 1000 });
const list = checklist();
const { check } = list;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms))]);
const js = (expr, what = "the page") => within(20000, b.js(expr), what);
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 100) / 10;

/** The shared workers Chrome is running now: [{ url, title }]. */
const sharedWorkers = async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).filter((t) => t.type === "shared_worker");

// What each shared worker logs as an error, or throws. A worker's console is
// its own; nothing it says reaches the page's.
const workerLogs = [];
const listening = new Set();
async function listenToWorkers() {
  for (const t of await sharedWorkers().catch(() => [])) {
    if (listening.has(t.id) || !t.webSocketDebuggerUrl) continue;
    listening.add(t.id);
    const name = t.title || t.url.split("/").at(-1);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === "Runtime.consoleAPICalled" && /error|warning/.test(m.params.type))
        workerLogs.push(`${name} ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400)}`);
      if (m.method === "Runtime.exceptionThrown") workerLogs.push(`${name} exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
    });
  }
}

const report = { package: pkg };

// How long a task that does nothing takes, asked for one at a time with both
// workers idle. Timed on one clock (the asker and the workers are the same
// machine): from asking to the run starting, the run itself, and from the
// run's end to the asker having the result. Three ways: the asker on this
// tab's tasks Repo (which shares a database with the workers), the asker on
// the site's own Repo (another peer: everything goes by the sync server), and
// code from the package, whose first run has the module to fetch.
// The same task again, with every step it takes timestamped where it happens (src/trace.ts): the
// median time from each step to the next, in the order they come.
async function steps(queueUrl, importUrl, n, repoExpr = "await window.patchworkTasks.repo") {
  const rows = await within(240_000, b.js(`(async () => {
    const J = await import(${JSON.stringify(`/${encodeURIComponent(pkg)}/dist/job-client.js`)});
    const R = ${repoExpr};
    const traces = [];
    const stop = J.tracing((t) => traces.push(t));
    await new Promise((r) => setTimeout(r, 300)); // the workers hear that someone is listening
    const asked = {};
    for (let i = 0; i < ${n}; i++) {
      const key = "steps-" + i + "-" + Math.random().toString(36).slice(2);
      const at = performance.timeOrigin + performance.now();
      let last;
      await J.run(R, ${JSON.stringify(queueUrl)}, { importUrl: ${importUrl}, input: 1, key }, (job) => (last = job));
      asked[last.taskUrl] = at;
      await new Promise((r) => setTimeout(r, 150)); // let the last of its traces arrive
    }
    stop();
    return Object.entries(asked).map(([id, at]) => [{ step: "asked", at }, ...traces.filter((t) => t.id === id)].sort((a, b) => a.at - b.at).map((t) => [t.step, t.at - at]));
  })()`), "the steps of a task");
  // the order the steps most often come in, and the median time each is reached
  const order = rows[0].map(([step]) => step);
  const median = (v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const at = Object.fromEntries(order.map((step) => [step, median(rows.map((r) => r.find(([s]) => s === step)?.[1]).filter((x) => x !== undefined))]));
  const sorted = order.slice().sort((a, b) => at[a] - at[b]);
  return sorted.map((step, i) => ({ step, at: Math.round(at[step] * 10) / 10, after: i ? Math.round((at[step] - at[sorted[i - 1]]) * 10) / 10 : 0 }));
}

async function latency(queueUrl, n) {
  const Q = JSON.stringify(queueUrl);
  const WAIT = JSON.stringify(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`);
  const run = (repoExpr, importUrl, input, count, tag) =>
    within(240_000, b.js(`(async () => {
      const J = await import(${JSON.stringify(`/${encodeURIComponent(pkg)}/dist/job-client.js`)});
      const R = ${repoExpr};
      const rows = [];
      for (let i = 0; i < ${count}; i++) {
        const key = ${JSON.stringify(tag)} + "-" + i + "-" + Math.random().toString(36).slice(2);
        const asked = Date.now();
        let last;
        await J.run(R, ${Q}, { importUrl: ${importUrl}, input: ${input}, key }, (job) => (last = job));
        const got = Date.now();
        const r = last.runs.at(-1);
        rows.push({ toStart: r.startTimeMillis - asked, ran: r.endTimeMillis - r.startTimeMillis, toAsker: got - r.endTimeMillis, total: got - asked });
      }
      return rows;
    })()`), tag);
  const NOOP = JSON.stringify("data:text/javascript," + encodeURIComponent("export default async function (x) { return x; }"));
  const summary = (rows) => {
    const of = (k) => {
      const v = rows.map((r) => r[k]).sort((a, b) => a - b);
      return { median: v[Math.floor(v.length / 2)], p90: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))], min: v[0], max: v.at(-1) };
    };
    return { n: rows.length, toStart: of("toStart"), ran: of("ran"), toAsker: of("toAsker"), total: of("total") };
  };
  const out = {};
  await run("await window.patchworkTasks.repo", NOOP, "1", 3, "warm-up");
  out.steps = await steps(queueUrl, NOOP, n);
  // the same from the site's own Repo, which every ordinary view asks through
  out.stepsFromTheSiteRepo = await steps(queueUrl, NOOP, n, "window.repo");
  out.sameDatabase = summary(await run("await window.patchworkTasks.repo", NOOP, "1", n, "local"));
  out.throughServer = summary(await run("window.repo", NOOP, "1", n, "server"));
  const fromPackage = await run("await window.patchworkTasks.repo", WAIT, `{ ms: 0 }`, n, "package");
  out.packageFirst = fromPackage[0];
  out.packageAfter = summary(fromPackage.slice(1));
  // Many at once: forty tasks of 20 ms each asked for together, on two workers. Were nothing in the
  // way, that is 40 x 20 ms / 2 = 400 ms; the rest is what each hand-over costs.
  out.fortyAtOnce = await within(240_000, b.js(`(async () => {
    const J = await import(${JSON.stringify(`/${encodeURIComponent(pkg)}/dist/job-client.js`)});
    const R = await window.patchworkTasks.repo;
    const tag = Math.random().toString(36).slice(2);
    const traces = [];
    const stopTracing = J.tracing((t) => traces.push(t));
    await new Promise((r) => setTimeout(r, 300));
    const t0b = performance.now();
    const asked = Date.now();
    const views = await Promise.all(Array.from({ length: 40 }, (_, i) => { let last; return J.run(R, ${Q}, { importUrl: ${WAIT}, input: { ms: 20 }, key: "burst-" + tag + "-" + i }, (job) => (last = job)).then(() => last); }));
    const ms = Math.round(performance.now() - t0b);
    await new Promise((r) => setTimeout(r, 300));
    stopTracing();
    // each worker's runs in order: when each started after the asking, and how long the worker sat between one and the next
    const byWorker = {};
    for (const v of views) { const r = v.runs.at(-1); (byWorker[r.workerUrl] ??= []).push([r.startTimeMillis - asked, r.endTimeMillis - asked, v.taskUrl]); }
    const at = (id, step) => traces.find((t) => t.id === id && t.step === step)?.at;
    const median = (v) => { v = v.filter((x) => x !== undefined && !Number.isNaN(x)).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : null; };
    const timeline = Object.values(byWorker).map((runs) => {
      runs.sort((a, b) => a[0] - b[0]);
      const between = (from, to, next = false) => median(runs.slice(0, next ? -1 : undefined).map((r, i) => at((next ? runs[i + 1] : r)[2], to) - at(r[2], from)));
      return {
        runs: runs.length, firstStart: runs[0][0], gaps: runs.slice(1).map((r, i) => r[0] - runs[i][1]),
        // the hand-over, step by step: from one task's run being recorded to the next one's starting
        handOver: {
          "recorded → worker says it is free": between("run recorded", "worker says it is free"),
          "says free → router sees it": between("worker says it is free", "router sees it is free"),
          "router sees it → next handed out": between("router sees it is free", "handed out", true),
          "handed out → worker told": between("handed out", "worker told"),
          "worker told → has the task": between("worker told", "worker has the task"),
          "has the task → run starts": between("worker has the task", "run starts"),
        },
      };
    });
    return { ms, perTaskOverheadMs: Math.round((ms - 400) / 40 * 2 * 10) / 10, timeline };
  })()`), "forty at once");
  return out;
}

// Tasks asked for by key (src/jobs.ts), through the client the package
// publishes (src/job-client.ts), imported from the package's own URL the way
// another package would import it.
async function jobs(queueUrl, pinnedPackage) {
  const PKG = JSON.stringify(pkg);
  const Q = JSON.stringify(queueUrl);
  // the task the package brings along, three ways of writing where it is
  const WAIT = JSON.stringify(`/${encodeURIComponent(pkg)}/dist/tasks/wait.js`); // no origin, no heads
  const WAIT_PINNED = JSON.stringify(`${new URL(SHELL).origin}/${encodeURIComponent(pinnedPackage)}/dist/tasks/wait.js`); // as import.meta.url gives it
  const WAIT_ELSEWHERE = JSON.stringify(`https://another-site.example/${encodeURIComponent(pinnedPackage)}/dist/tasks/wait.js`); // made on another site
  // J: the client; T: this tab's tasks Repo, which it goes through; site: the site's own Repo, another replica
  const call = (body, what, ms = 60_000) =>
    within(ms, b.js(`(async () => { const J = await import(${JSON.stringify(`/${encodeURIComponent(pkg)}/dist/job-client.js`)}); const Q = ${Q}; const site = window.repo; const T = await window.patchworkTasks.repo; ${body} })()`), what);
  const out = (report.jobs = {});
  check("the tasks Repo is on the page", await b.waitFor("!!window.patchworkTasks?.repo", 20_000, 250));

  // 1. Two askers of one key at the same moment, from two Repos: one task, run once.
  out.same = await call(`
    // (long enough that the second ask has reached the worker before the run is over: see src/jobs.ts)
    const key = "probe-same", input = { ms: 1500, value: "a" };
    const q = await site.find(Q);
    const byHand = site.create({ input, importUrl: ${WAIT}, runs: [], key });
    const viaClient = J.ask(T, Q, { importUrl: ${WAIT}, input, key });
    q.change((d) => { if (!d.jobs[key]) d.jobs[key] = { taskUrl: byHand.url, askedAt: Date.now(), package: ${PKG} }; });
    const asked = await viaClient;
    const result = await J.run(T, Q, { importUrl: ${WAIT}, input, key });
    await new Promise((r) => setTimeout(r, 1500));
    const runsOf = async (url) => (await T.find(url)).doc().runs.length;
    const named = (await T.find(Q)).doc().jobs[key];
    return { result, named: named.taskUrl, done: named.done, tasks: [asked.taskUrl, byHand.url], runs: [await runsOf(asked.taskUrl), await runsOf(byHand.url)] };`, "one key, two askers");
  check("two askers of one key get one task, run once", out.same.result === "a" && out.same.done === true && new Set(out.same.tasks).size === 2 && out.same.runs[0] + out.same.runs[1] === 1 && out.same.runs[out.same.tasks.indexOf(out.same.named)] === 1, out.same);

  // 2. Progress and log lines, heard while it runs and written nowhere until it's over.
  out.progress = await call(`
    const seen = [];
    let midRun = null;
    const result = await J.run(T, Q, { importUrl: ${WAIT_PINNED}, input: { ms: 2500, value: "b" }, key: "probe-progress" }, (job) => {
      seen.push([job.state, job.progress, job.logs.length]);
      if (job.state === "running" && job.taskUrl && !midRun) T.find(job.taskUrl).then((h) => (midRun ??= JSON.parse(JSON.stringify(h.doc()))));
    });
    const fractions = [...new Set(seen.filter(([s, p]) => s === "running" && typeof p === "number").map(([, p]) => p))];
    return { result, fractions: fractions.length, range: [Math.min(...fractions), Math.max(...fractions)], heardLogWhileRunning: seen.some(([s, , n]) => s === "running" && n > 0), states: [...new Set(seen.map(([s]) => s))], docWhileRunning: midRun && { keys: Object.keys(midRun).sort(), current: Object.keys(midRun.current ?? {}).sort(), runs: midRun.runs.length } };`, "a task that reports progress");
  check("a running task's progress and log are heard while it runs", out.progress.result === "b" && out.progress.fractions >= 5 && out.progress.range[0] >= 0 && out.progress.range[1] <= 1 && out.progress.heardLogWhileRunning, out.progress);
  check("and nothing of them is in its doc until it's over", out.progress.docWhileRunning?.runs === 0 && out.progress.docWhileRunning.current.join() === "assignment,startTimeMillis,workerUrl", out.progress.docWhileRunning);

  // 3. Stopping a task that's running.
  out.stop = await call(`
    const key = "probe-stop";
    const states = [];
    let running, over;
    const isRunning = new Promise((r) => (running = r)), isOver = new Promise((r) => (over = r));
    const stop = J.watch(T, Q, key, (job) => { states.push(job.state); if (job.state === "running") running(); if (job.state === "cancelled") over(job); });
    await J.ask(T, Q, { importUrl: ${WAIT}, input: { ms: 60000 }, key });
    await isRunning;
    const t0 = Date.now();
    const cancelled = await J.cancel(T, Q, key);
    const job = await isOver;
    stop();
    return { cancelled, stoppedAfterMs: Date.now() - t0, states: [...new Set(states)], runs: job.runs.map((r) => r.status), again: await J.cancel(T, Q, key) };`, "stopping a running task");
  check("a running task stops when asked, and says it was stopped", out.stop.cancelled === true && out.stop.stoppedAfterMs < 4000 && out.stop.runs.at(-1) === "cancelled" && out.stop.again === false, out.stop);

  // 4. A task whose code throws has failed: it is not run again.
  out.fail = await call(`
    let last;
    const error = await J.run(T, Q, { importUrl: ${WAIT}, input: { ms: 50, fail: true }, key: "probe-fail" }, (job) => (last = job)).then(() => null, (e) => e.message);
    return { error, state: last.state, runs: last.runs.map((r) => r.status) };`, "a task that fails");
  check("a task whose code throws has failed, once, and says why", out.fail.error === "asked to fail" && out.fail.state === "failed" && out.fail.runs.join() === "failed", out.fail);

  // 5. A finished task answers for its key until it's forgotten.
  out.again = await call(`
    const key = "probe-same";
    const before = (await J.ask(T, Q, { importUrl: ${WAIT}, input: { ms: 1500, value: "a" }, key })).taskUrl;
    const kept = await J.run(T, Q, { importUrl: ${WAIT}, input: { ms: 300, value: "IGNORED" }, key });
    await J.forget(T, Q, key);
    const fresh = await J.run(T, Q, { importUrl: ${WAIT}, input: { ms: 100, value: "c" }, key });
    const after = (await T.find(Q)).doc().jobs[key].taskUrl;
    return { kept, fresh, newTask: after !== before };`, "asking again");
  check("asking again under a finished key gives its answer; forgetting it runs it afresh", out.again.kept === "a" && out.again.fresh === "c" && out.again.newTask, out.again);

  // 6. Code is wherever its import URL says: made on another site, it is fetched from this one; a data: URL is the code itself.
  out.code = await call(`
    const elsewhere = await J.run(T, Q, { importUrl: ${WAIT_ELSEWHERE}, input: { ms: 100, value: "d" }, key: "probe-elsewhere" });
    const code = 'export default async function (n, { progress, log }) { log("doubling", n); progress("half way"); return n * 2; }';
    const inline = await J.run(T, Q, { importUrl: "data:text/javascript;base64," + btoa(code), input: 21, key: "probe-data" });
    return { elsewhere, inline };`, "code from elsewhere");
  check("a URL made on another site runs from this one, and a data: URL runs as it is", out.code.elsewhere === "d" && out.code.inline === 42, out.code);

  // 7. Whose code these workers run from this queue: only this package's, then anyone's again.
  out.accept = await call(`
    const account = window.accountDocHandle;
    const taking = async () => { const d = (await T.find(Q)).doc(); return d; };
    const data = "data:text/javascript," + encodeURIComponent("export default async function () { return 'ran' }");
    const view = (key) => new Promise((r) => { const stop = J.watch(T, Q, key, (job) => { if (job.taskUrl && job.input !== undefined) { stop(); r(job); } }); });
    account.change((d) => { d.__taskQueues__[Q] = { packages: [${PKG}] }; });
    await new Promise((r) => setTimeout(r, 3000)); // the workers hear, say so in their docs, and the router sees it
    await J.ask(T, Q, { importUrl: data, input: null, key: "probe-not-accepted" });
    const fromPackage = await J.run(T, Q, { importUrl: ${WAIT}, input: { ms: 100, value: "e" }, key: "probe-accepted" });
    await new Promise((r) => setTimeout(r, 3000));
    const refused = await view("probe-not-accepted");
    account.change((d) => { d.__taskQueues__[Q] = true; });
    const afterwards = await J.run(T, Q, { importUrl: data, input: null, key: "probe-not-accepted" });
    return { fromPackage, refused: { state: refused.state, runs: refused.runs.length }, afterwards };`, "what the workers accept", 90_000);
  check("workers told to run only this package's code leave a data: URL waiting, and run it once told they may", out.accept.fromPackage === "e" && out.accept.refused.state === "waiting" && out.accept.refused.runs === 0 && out.accept.afterwards === "ran", out.accept);

  const left = await call(`const d = (await T.find(Q)).doc(); return Object.entries(d.jobs).filter(([, j]) => !j.done).map(([k]) => k);`, "what's left");
  check("nothing asked for by key is left unfinished", left.length === 0, left);
}

try {
  await b.send("Page.navigate", { url: SHELL });
  const booted = await b.waitFor("!!window.repo && !!window.accountDocHandle", 90_000, 500);
  check("the shell booted", booted);

  // A queue of this profile's own, the only one its account is on, and then the package.
  const setup = await js(`(async () => {
    const acct = window.accountDocHandle;
    const q = window.repo.create({ "@patchwork": { type: "task-queue-next" }, title: "probe queue", activeRouter: null, pending: [], done: [], doneSet: {}, jobs: {} });
    acct.change((d) => { d.__taskQueues__ = { [q.url]: true }; });
    const msUrl = acct.doc().moduleSettingsUrl;
    const ms = msUrl ? await window.repo.find(msUrl) : null;
    ms?.change((d) => { if (!d.modules) d.modules = []; if (!d.modules.includes(${JSON.stringify(pkg)})) d.modules.push(${JSON.stringify(pkg)}); });
    window.__probe = { q, tasks: [] };
    return { queueUrl: q.url, moduleSettings: msUrl ?? null, modules: ms?.doc().modules ?? null, accountKeys: Object.keys(acct.doc()) };
  })()`);
  Object.assign(report, setup);
  check("the package is in this profile's module settings", setup.modules?.includes(pkg), setup);

  // Open the queue: its browser is this package's tool, and the title bar badge starts the workers.
  await js(`location.hash = "#doc=" + ${JSON.stringify(setup.queueUrl)}`);
  // The badge is what starts the workers, and a frame puts it up: threepane in
  // its title bar, the tiling frame in its tray. A fresh profile's frame has
  // neither, so the probe puts the badge up itself, the way a frame would.
  const MOUNT_BADGE = `(() => {
    if (document.querySelector("#probe-badge")) return true;
    const host = document.querySelector("repo-provider") ?? document.body;
    const v = document.createElement("patchwork-view");
    v.id = "probe-badge";
    v.setAttribute("tool-id", "task-titlebar-next");
    v.setAttribute("doc-url", ${JSON.stringify(setup.queueUrl)});
    host.appendChild(v);
    return true;
  })()`;
  await b.waitFor(`/pending/.test(document.body.innerText)`, 60_000, 500); // the queue browser is up: the package has loaded
  await js(MOUNT_BADGE);
  let workers = [];
  let reloaded = false;
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    await sleep(1000);
    workers = await sharedWorkers().catch(() => []);
    await listenToWorkers();
    if (workers.filter((w) => w.url.includes(ID)).length >= 4) break;
    // A shell that only reads module settings as it starts needs starting again; once.
    if (!reloaded && Date.now() - started > 45_000 && !workers.some((w) => w.url.includes(ID))) {
      reloaded = true;
      await b.send("Page.reload");
      await b.waitFor("!!window.repo && !!window.accountDocHandle", 60_000, 500);
      await b.waitFor(`/pending/.test(document.body.innerText)`, 60_000, 500);
      await js(MOUNT_BADGE);
    }
  }
  report.reloadedToLoadPackage = reloaded;
  if (process.argv.includes("--debug"))
    report.debug = await js(`({ hash: location.hash, text: document.body.innerText.slice(0, 600), patchwork: Object.keys(window.patchwork ?? {}), sameOrigin: location.origin })`).catch((e) => String(e));
  report.workers = workers.map((w) => ({ name: w.title, url: w.url }));
  report.workersUpAt = secs();
  // (the site runs a shared worker of its own; the task framework's are all named "task-…")
  const taskWorkers = workers.filter((w) => /^task-/.test(w.title ?? ""));
  const mine = taskWorkers.filter((w) => w.url.includes(ID));
  check("a pool, a router and two workers are running", mine.length === 4, report.workers);
  check("every task worker comes from this package", taskWorkers.length > 0 && mine.length === taskWorkers.length, report.workers);

  // The queue again, as this page's repo has it now (a reload made a new page).
  await js(`(async () => { window.__probe = { q: await window.repo.find(${JSON.stringify(setup.queueUrl)}), tasks: [] }; })()`);
  const routerAt = await b.waitFor("window.__probe.q.doc().activeRouter", 60_000, 250);
  report.router = routerAt || null;
  report.routerAt = secs();
  check("a router took the queue", !!routerAt);

  if (LATENCY) {
    report.latency = await latency(setup.queueUrl, LATENCY);
    console.log(JSON.stringify(report.latency, null, 1));
    b.stop(0);
    await sleep(2000);
  }

  await js(`(() => {
    const { q } = window.__probe;
    const code = 'export default async function (n) { this.log("squaring", n); await new Promise((r) => setTimeout(r, 50)); return n * n; }';
    const importUrl = "data:application/javascript;base64," + btoa(code);
    const tasks = [];
    for (let i = 0; i < ${TASKS}; i++) tasks.push(window.repo.create({ input: i, importUrl, runs: [] }));
    q.change((d) => { for (const t of tasks) d.pending.push(t.url); });
    window.__probe.tasks = tasks;
  })()`);
  const enqueuedAt = Date.now();
  const STATUS = `(() => { const { q, tasks } = window.__probe; const d = q.doc(); return { pending: d.pending.length, done: d.done.length, runs: tasks.map((t) => t.doc().runs.map((r) => r.status + ":" + r.result)) }; })()`;
  let st = null;
  while (Date.now() - enqueuedAt < WAIT * 1000) {
    await sleep(500);
    await listenToWorkers();
    st = await js(STATUS).catch(() => st);
    if (st && st.pending === 0 && st.runs.every((r) => r.length)) break;
  }
  report.tasksSeconds = Math.round((Date.now() - enqueuedAt) / 100) / 10;
  report.status = st;
  const want = Array.from({ length: TASKS }, (_, i) => `succeeded:${i * i}`);
  check(`all ${TASKS} tasks ran and gave the right answer`, !!st && st.runs.every((r, i) => r.at(-1) === want[i]), st);
  check("each ran exactly once", !!st && st.runs.every((r) => r.length === 1), st?.runs.map((r) => r.length));
  check("the queue has nothing pending", st?.pending === 0, st);

  // the package at the heads this browser loaded it at, as its workers' script URLs name it
  const pinnedPackage = decodeURIComponent(new URL(mine[0].url).pathname.slice(1).split("/")[0]);
  report.pinnedPackage = pinnedPackage;
  if (!process.argv.includes("--no-jobs")) await jobs(setup.queueUrl, pinnedPackage);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await sleep(1500);
    report.shot = await within(30000, b.shot(join(SHOTS, `real-run-${ID.slice(0, 8)}.png`)), "the screenshot").catch((e) => String(e));
  }
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
const pageErrors = b.logs.filter((l) => /^(error|exception)/i.test(l) && (l.includes(ID) || /task/i.test(l)));
check("no page errors from this package", pageErrors.length === 0, pageErrors.slice(0, 10));
// (the task the probe asks to fail says so in its worker's console, each of the three times it's tried)
const said = workerLogs.filter((l) => / (error|exception):/.test(l));
const expected = said.filter((l) => /asked to fail/.test(l) || / error: task failed$/.test(l));
const tried = said.filter((l) => / error: task failed$/.test(l)).length;
const workerErrors = said.filter((l) => !expected.includes(l));
check("no shared worker errors but the failing task's", workerErrors.length === 0 && (tried === 3 || process.argv.includes("--no-jobs")), { tried, workerErrors: workerErrors.slice(0, 10) });
if (process.argv.includes("--debug")) report.pageLogs = b.logs.filter((l) => /task|worker|module|plugin|error|exception/i.test(l)).slice(-60).map((l) => l.slice(0, 300));
console.log(JSON.stringify({ ...report, seconds: secs(), checks: list.checks, details: list.details, workerLogs: workerLogs.slice(0, 30) }, null, 2));
b.stop(list.failed ? 1 : 0);
