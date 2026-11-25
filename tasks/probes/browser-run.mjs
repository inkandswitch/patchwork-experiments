// The browser's pool, proved on this machine without publishing anything: a
// throwaway Chrome profile opens tabs of a stand-in page (browser-run/) that
// loads the BUILT package from dist/, mounts its real titlebar tool (which
// starts the page's pool host) and asks through the built task-client. Task
// code comes from data: URLs and from a file served here; the queue accepts
// any code. No sync server is reached: every Repo works from the profile's
// shared database.
//
//   (in tasks/, after `pnpm build`)
//   /Users/pvh/dev/pwx-one/tools/slot.sh chrome -- node probes/browser-run.mjs [--show]
//
// --show runs Chrome in a visible window instead of headless (check 9 needs a
// page that the browser really hides; headless Chrome may not).
//
// What stands in for Patchwork: the site's modules (Repo, storage,
// automerge, subduction, solid), bundled here from this package's own
// node_modules and named in the page's import map as the site names them;
// automerge.wasm and subduction.wasm at the root; an account document with a
// queue on its list; and the page's tasks Repo, which the site would have.
// A copy of dist/ stamped as a newer build is served at /dist-newer.
//
// Each check prints one line with what was observed; the process exits 1 if
// any failed. The files are served here (not by cdp.mjs, see below); Chrome
// is launched and guarded as cdp.mjs does it, and driven over one browser-level CDP connection, with
// every page's dedicated workers (and theirs) attached, so that a run worker
// can be seen to go.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { sleep } from "./cdp.mjs";
import { guardChrome, killChrome } from "./chrome-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOW = process.argv.includes("--show");
// --debug: everything workers and pages log, not only their errors
const DEBUG = process.argv.includes("--debug");
const PORT = 47911;
const CDP = 47912;
const GRACE_MS = 5_000;

const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);
const J = JSON.stringify;
const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const NOOP = dataUrl("export default () => 1;");
const LOGS = dataUrl(
  "export default async (input, ctx) => { for (let i = 1; i <= 3; i++) { ctx.log('line ' + i); ctx.progress(i / 3); await new Promise((r) => setTimeout(r, 400)); } return 'logged'; };",
);
const THROWS = dataUrl("export default () => { throw new Error('thrown on purpose'); };");
const SPIN = dataUrl("export default () => { for (;;) {} };");
const SLEEP = `http://127.0.0.1:${PORT}/probe/tasks/sleep.js`;

// ── what is served ──

if (!existsSync(join(PKG, "dist/index.js"))) {
  console.error("build the package first: pnpm build");
  process.exit(2);
}
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "tasks-browser-run-"));
const modules = join(PKG, "node_modules");
// The site's Repo is not this package's: its import map gives a later one
// (with `headsChannel`, which is how a browser's Repos hear each other's
// saves). Those versions are this package's dev dependencies under `site-`
// names, and automerge and subduction come from the ones that Repo uses.
const siteRepo = realpathSync(join(modules, "site-automerge-repo"));
const siteModules = resolve(siteRepo, "../..");
symlinkSync(join(PKG, "dist"), join(root, "dist"));
symlinkSync(join(HERE, "browser-run"), join(root, "probe"));
symlinkSync(join(siteModules, "@automerge/automerge/dist/automerge.wasm"), join(root, "automerge.wasm"));
symlinkSync(join(siteModules, "@automerge/automerge-subduction/dist/automerge-subduction.wasm"), join(root, "subduction.wasm"));

// The site's modules, one file per name in the import map, sharing chunks so
// that there is one automerge among them, as on the site.
const stubs = join(root, "stubs");
mkdirSync(stubs);
const vendor = {
  "automerge-slim": "@automerge/automerge/slim",
  "automerge-repo-slim": "site-automerge-repo/slim",
  "automerge-repo-storage-indexeddb": "site-automerge-repo-storage-indexeddb",
  "automerge-subduction-slim": "@automerge/automerge-subduction/slim",
  "solid-js": "solid-js",
  "solid-js-web": "solid-js/web",
};
const entryPoints = {};
for (const [name, spec] of Object.entries(vendor)) {
  writeFileSync(join(stubs, `${name}.js`), `export * from ${J(spec)};\n`);
  entryPoints[name] = join(stubs, `${name}.js`);
}
entryPoints["task-client"] = join(PKG, "src/task-client.js");
await build({
  entryPoints,
  outdir: join(root, "vendor"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // the site Repo's own automerge and subduction before anything else of that name
  nodePaths: [siteModules, modules],
  logLevel: "warning",
  plugins: [
    {
      // The Repo imports the full automerge and subduction (wasm included)
      // only when asked to start them itself; the page starts the slim ones.
      name: "leave-the-full-builds-out",
      setup(b) {
        b.onResolve({ filter: /^@automerge\/automerge(-subduction)?$/ }, ({ path }) => ({ path, external: true }));
      },
    },
  ],
});

// The same build, stamped newer: what a tab that loaded a later copy of the package runs.
cpSync(join(PKG, "dist"), join(root, "dist-newer"), { recursive: true });
let stamp = null;
for (const file of readdirSync(join(root, "dist-newer/assets"))) {
  const path = join(root, "dist-newer/assets", file);
  if (!file.endsWith(".js")) continue;
  const text = readFileSync(path, "utf8");
  const found = text.match(/const (\w+) = (\d{13}), (\w+) = "patchwork-tasks-pool"/);
  if (found) {
    stamp = Number(found[2]);
    writeFileSync(path, text.replace(found[0], `const ${found[1]} = ${stamp + 60_000}, ${found[3]} = "patchwork-tasks-pool"`));
  }
}
if (!stamp) throw new Error("the build stamp was not found in dist: has pool-host.ts changed shape?");

// ── Chrome, and its tabs and workers over one CDP connection ──

// Served like cdp.mjs's server, but `no-cache` where that one says
// `no-store`: Chrome keeps no page served `no-store` in its back/forward
// cache, and check 7 is about a page that it does keep there.
const MIME = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "tasks-browser-run-profile-"));
const chrome = spawn(
  CHROME,
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, "--window-size=1000,700", "about:blank"].filter(Boolean),
  { stdio: "ignore", detached: true },
);
let stopped = false;
const stop = (code) => {
  if (stopped) return;
  stopped = true;
  killChrome(chrome);
  server.close();
  setTimeout(() => {
    for (const dir of [profile, root]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    process.exit(code);
  }, 500);
};
guardChrome(chrome, { profile, stop });
setTimeout(() => (console.error("TIMEOUT"), stop(2)), 10 * 60_000).unref();

let version;
for (let i = 0; i < 150 && !version; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
  } catch {
    await sleep(100);
  }
}
if (!version) throw new Error("Chrome didn't start");
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
/** Every attached dedicated worker, by session: its url, the session it hangs from, and when it went. */
const workers = new Map();
const workerLogs = [];
/** Why Chrome did not keep a page in its back/forward cache, by page session, when it said. */
const notCached = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Page.backForwardCacheNotUsed") notCached.set(m.sessionId, (m.params.notRestoredExplanations ?? []).map((e) => e.reason));
  if (m.id && pending.has(m.id)) {
    const { ok, no, method } = pending.get(m.id);
    pending.delete(m.id);
    return m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
  }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "worker") {
    const { sessionId, targetInfo } = m.params;
    workers.set(sessionId, { url: targetInfo.url, parent: m.sessionId, at: Date.now(), gone: null });
    // its own workers, and what it says that is an error
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    send("Runtime.enable", {}, sessionId).catch(() => {});
  }
  if (m.method === "Target.detachedFromTarget" && workers.has(m.params.sessionId)) {
    workers.get(m.params.sessionId).gone = Date.now();
  }
  if (DEBUG && m.method === "Runtime.consoleAPICalled" && !workers.has(m.sessionId))
    workerLogs.push(`page ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)}`);
  if (DEBUG && m.method === "Runtime.exceptionThrown" && !workers.has(m.sessionId)) workerLogs.push(`page exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  if (m.sessionId && workers.has(m.sessionId)) {
    const name = workers.get(m.sessionId).url.split("/").at(-1).replace(/-[\w]{8}\.js$/, "");
    if (m.method === "Runtime.consoleAPICalled" && (DEBUG || /error/.test(m.params.type)))
      workerLogs.push(`${name}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)}`);
    if (m.method === "Runtime.exceptionThrown") workerLogs.push(`${name} exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no, method });
    ws.send(J({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const base = `http://127.0.0.1:${PORT}`;
const DUMP = `(async () => {
  const within = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('not found in 3 s')), 3000))]);
  const out = {};
  for (const [name, url] of Object.entries(await globalThis.repo ? {} : {})) out[name] = url;
  const handles = Object.values(globalThis.repo.handles ?? {});
  out.handles = handles.map((h) => h.url + ' ' + h.state);
  for (const h of handles) { try { const d = h.doc(); if (d && d.jobs) out.queue = d.jobs; if (d && d.runs) (out.tasks ??= {})[h.url] = d.runs; } catch (e) {} }
  return JSON.stringify(out);
})()`;

/** The page session a worker hangs from, however deep. */
const pageOf = (sessionId) => {
  let at = sessionId;
  while (workers.has(at)) at = workers.get(at).parent;
  return at;
};
/** The live workers of one tab whose script url matches. */
const liveWorkers = (tab, pattern) =>
  [...workers.entries()].filter(([id, w]) => !w.gone && pattern.test(w.url) && pageOf(id) === tab.sessionId).map(([id]) => id);

async function tab(label, path = "/probe/index.html") {
  const { targetId } = await send("Target.createTarget", { url: `${base}${path}`, background: false });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  const js = async (expr, ms = 60_000) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId),
      sleep(ms).then(() => ({ exceptionDetails: { text: `no answer in ${ms} ms` } })),
    ]);
    if (r.exceptionDetails) throw new Error(`${label}: ${expr.slice(0, 120)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const waitFor = async (expr, ms = 15_000, every = 50) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try {
        v = await js(expr, 5_000);
      } catch {}
      if (v) return v;
      if (Date.now() - t0 > ms) return false;
      await sleep(every);
    }
  };
  const t = { label, targetId, sessionId, js, waitFor };
  if (!(await waitFor("window.ready === true", 20_000))) throw new Error(`${label}: the page did not start`);
  return t;
}

let failed = false;
const check = (name, ok, observed) => {
  console.error(`${ok ? "ok  " : "FAIL"} ${name}: ${observed}`);
  if (!ok) failed = true;
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const runsOf = (view) => (view?.runs ?? []).map((run) => run.status ?? "open");
const stateIs = (key, ...states) => `${J(states)}.includes(probe.last(${J(key)})?.state)`;

let A;
try {
  log(`Chrome ${version.Browser}${SHOW ? ", visible" : ", headless"}; build ${stamp}, newer copy ${stamp + 60_000}`);
  A = await tab("A");
  await A.js("probe.makeAccount()");
  await A.js("probe.mount()");
  const slots = await A.js("Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))");
  if (!(await A.waitFor("probe.status()?.state === 'running'", 30_000))) {
    throw new Error(`tab A's pool did not start: ${J(await A.js("probe.status()"))} ${J(workerLogs)}`);
  }
  const poolId = await A.js("localStorage.getItem('patchwork-tasks-pool-id')");
  log(`A runs pool ${poolId}, ${slots} slots`);

  // 1. a do-nothing task, ask to result, ten in a row
  {
    const first = await A.js(`probe.timeRun(${J(NOOP)})`);
    const times = [];
    for (let i = 0; i < 10; i++) times.push((await A.js(`probe.timeRun(${J(NOOP)})`)).ms);
    check(
      "1 a do-nothing task, ten in a row",
      times.length === 10,
      `first (starts a run worker) ${first.ms.toFixed(0)} ms; then median ${median(times).toFixed(1)} ms, worst ${Math.max(...times).toFixed(1)} ms (old system: about 47 ms)`,
    );
  }

  // 2. logs and progress heard while running, and kept with the record
  {
    const key = await A.js(`probe.ask(${J(LOGS)})`);
    await A.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    const views = await A.js(`probe.views[${J(key)}]`);
    const running = views.filter((v) => v.state === "running");
    const progress = [...new Set(running.map((v) => v.progress).filter((p) => p !== null))];
    const heardLines = [...new Set(running.flatMap((v) => v.logs))];
    const last = views.at(-1);
    const kept = last.runs[0]?.logs ?? [];
    check(
      "2 logs and progress heard while running; the record keeps the lines",
      last.state === "succeeded" && progress.length >= 2 && heardLines.includes("line 1") && ["line 1", "line 2", "line 3"].every((l) => kept.includes(l)),
      `progress heard ${J(progress.map((p) => +Number(p).toFixed(2)))}, lines heard while running ${J(heardLines)}, record's lines ${J(kept)}, ${last.state}`,
    );
  }

  // 3. a throwing task fails once
  {
    const key = await A.js(`probe.ask(${J(THROWS)})`);
    await A.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    await sleep(3_000); // time for a second run, if anything were to start one
    const last = await A.js(`probe.last(${J(key)})`);
    check("3 a throwing task fails once", last.state === "failed" && J(runsOf(last)) === J(["failed"]) && /thrown on purpose/.test(last.error), `${last.state}, runs ${J(runsOf(last))}, error ${J(last.error)}`);
  }

  // 4. a spinning task, cancelled
  {
    const key = await A.js(`probe.ask(${J(SPIN)})`);
    await A.waitFor(stateIs(key, "running"), 20_000);
    await sleep(500);
    const spinning = liveWorkers(A, /run-worker-entry/);
    const t0 = Date.now();
    await A.js(`probe.cancel(${J(key)})`);
    await A.waitFor(stateIs(key, "cancelled", "failed", "succeeded"), GRACE_MS + 10_000);
    const cancelledAt = Date.now() - t0;
    await new Promise((r) => {
      const until = Date.now() + GRACE_MS + 5_000;
      const look = () => (spinning.every((id) => workers.get(id).gone) || Date.now() > until ? r() : setTimeout(look, 50));
      look();
    });
    const goneIn = spinning.map((id) => (workers.get(id).gone ? workers.get(id).gone - t0 : null));
    const states = await A.js(`probe.states(${J(key)})`);
    const next = await A.js(`probe.timeRun(${J(NOOP)})`).catch((e) => ({ error: String(e.message ?? e) }));
    check(
      "4 a spinning task cancelled: stopping, then cancelled; its run worker gone; the next task runs",
      states.includes("stopping") && states.indexOf("stopping") < states.indexOf("cancelled") && spinning.length === 1 && goneIn.every((ms) => ms !== null && ms <= GRACE_MS + 3_000) && next.result === 1,
      `states ${J(states)}; cancelled read ${cancelledAt} ms after asking; ${spinning.length} run worker(s) alive at the cancel, gone after ${J(goneIn)} ms (bound ${GRACE_MS + 3_000}); next task ${next.result === 1 ? `ran in ${next.ms.toFixed(0)} ms` : J(next)}`,
    );
  }

  // 5. two tabs: one holds the lock and runs tasks, the other's badge says it waits
  const B = await tab("B");
  await B.js("probe.mount()");
  {
    await B.waitFor("probe.badge()?.state === 'waiting'", 15_000);
    const badge = await B.js("probe.badge()");
    const locks = await B.js("probe.locks()");
    const fromB = await B.js(`probe.timeRun(${J(NOOP)})`).catch((e) => ({ error: String(e.message ?? e) }));
    const pools = { A: liveWorkers(A, /pool-worker/).length, B: liveWorkers(B, /pool-worker/).length };
    check(
      "5 two tabs: exactly one holds the lock and runs tasks; the other's badge says it waits",
      locks.held === 1 && locks.pending === 1 && (await A.js("probe.status().state")) === "running" && badge?.state === "waiting" && /another tab/.test(badge.text) && pools.A === 1 && pools.B === 0 && fromB.result === 1,
      `locks ${J(locks)}; A ${await A.js("probe.status().state")}, B's badge ${J(badge?.text)} (${badge?.state}); pool workers A ${pools.A}, B ${pools.B}; a task asked from B ${fromB.result === 1 ? `ran in ${fromB.ms.toFixed(0)} ms` : J(fromB)}`,
    );
  }

  // 6. the holding tab closed mid-run
  {
    const key = await B.js(`probe.ask(${J(SLEEP)}, { ms: 4000, value: 'six' })`);
    await B.waitFor(stateIs(key, "running"), 20_000);
    await sleep(1_000);
    const t0 = Date.now();
    await send("Target.closeTarget", { targetId: A.targetId });
    await B.waitFor("probe.status()?.state === 'running'", 15_000, 10);
    const took = (await B.js("probe.statusLog.find((s) => s.state === 'starting' || s.state === 'running')?.t")) - t0;
    await B.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 30_000);
    const last = await B.js(`probe.last(${J(key)})`);
    check(
      "6 the holding tab closed mid-run: the other takes the lock; its pool (same id) records the run lost and runs it again",
      last.state === "succeeded" && last.result === "six" && J(runsOf(last)) === J(["lost", "succeeded"]) && last.runs.every((run) => run.pool === poolId),
      `B took the lock ${took} ms after the close; runs ${J(runsOf(last))} by ${J([...new Set(last.runs.map((r) => r.pool?.slice(0, 8)))])}; ${last.state} ${J(last.result)}`,
    );
  }

  // 7. the holding tab navigates away mid-run
  const C = await tab("C");
  await C.js("probe.mount()");
  {
    await C.waitFor("probe.status()?.state === 'waiting'", 15_000);
    const key = await C.js(`probe.ask(${J(SLEEP)}, { ms: 4000, value: 'seven' })`);
    await C.waitFor(stateIs(key, "running"), 20_000);
    await sleep(1_000);
    const t0 = Date.now();
    await send("Page.navigate", { url: `${base}/probe/away.html` }, B.sessionId);
    await C.waitFor("probe.status()?.state === 'running'", 60_000, 10);
    const took = (await C.js("probe.statusLog.find((s) => s.state === 'starting' || s.state === 'running')?.t")) - t0;
    await C.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 30_000);
    const last = await C.js(`probe.last(${J(key)})`);
    // Back again: a page restored from the back/forward cache asks for the lock again (pageshow) and waits behind C.
    notCached.delete(B.sessionId);
    await B.js("history.back(), true");
    await B.waitFor("document.readyState === 'complete' && !!window.probe", 15_000);
    await sleep(1_000);
    const restored = (await B.js("window.probe?.statusLog?.length ?? 0")) > 0;
    const back = restored ? await B.js("probe.status()?.state") : null;
    const locks = await C.js("probe.locks()");
    const cache = restored ? `restored from the back/forward cache, where it now ${back === "waiting" ? "waits" : `reads ${back}`}` : `not restored from the cache (${(notCached.get(B.sessionId) ?? []).slice(0, 3).join(", ") || "no reason given"})`;
    check(
      "7 the holding tab navigated away mid-run: the lock passes at once, the run is lost and run again",
      took < 5_000 && last.state === "succeeded" && J(runsOf(last)) === J(["lost", "succeeded"]) && (!restored || back === "waiting") && (await C.js("probe.status().state")) === "running" && locks.held === 1,
      `C took the lock ${took} ms after the navigation; runs ${J(runsOf(last))}, ${last.state} ${J(last.result)}; going back, B's page was ${cache}; locks ${J(locks)}`,
    );
  }

  // 8. a newer build starts while the old holder has a run going
  let D;
  {
    const first = await C.js(`probe.ask(${J(SLEEP)}, { ms: 5000, value: 'old' })`);
    await C.waitFor(stateIs(first, "running"), 20_000);
    D = await tab("D");
    await D.js("probe.mount('/dist-newer')");
    const second = await C.js(`probe.ask(${J(NOOP)})`);
    await C.waitFor(stateIs(first, "succeeded", "failed", "cancelled"), 30_000);
    await D.waitFor("probe.status()?.state === 'running'", 30_000);
    await C.waitFor(stateIs(second, "succeeded", "failed", "cancelled"), 30_000);
    const cLog = await C.js("probe.statusLog.map((s) => ({ t: s.t, state: s.state }))");
    const stoodDown = cLog.find((s) => s.state === "stood down")?.t;
    const handing = cLog.find((s) => s.state === "handing over")?.t;
    const a = await C.js(`probe.last(${J(first)})`);
    const b = await C.js(`probe.last(${J(second)})`);
    const dRunning = (await D.js("probe.statusLog.find((s) => s.state === 'running')?.t")) ?? null;
    const secondStart = b.runs[0]?.start;
    check(
      "8 a newer build: the old pool finishes its run, takes nothing new, lets go; the new one runs the next task",
      !!handing && !!stoodDown && J(runsOf(a)) === J(["succeeded"]) && a.result === "old" && b.state === "succeeded" && J(runsOf(b)) === J(["succeeded"]) && secondStart >= stoodDown && liveWorkers(C, /pool-worker/).length === 0 && liveWorkers(D, /pool-worker/).length === 1,
      `C: handing over, then stood down ${stoodDown - handing} ms later; the old run ${J(runsOf(a))} ${J(a.result)}; the next task's run started ${secondStart - stoodDown} ms after C let go (D running ${dRunning - stoodDown} ms after), ${b.state}; pool workers C ${liveWorkers(C, /pool-worker/).length}, D ${liveWorkers(D, /pool-worker/).length}`,
    );
  }

  // 9. a hidden holder keeps its run heard
  const E = await tab("E"); // opened in front of D, in the same window
  await E.js("probe.mount()");
  {
    const key = await D.js(`probe.ask(${J(SLEEP)}, { ms: 36000, value: 'nine' })`);
    await D.waitFor(stateIs(key, "running"), 20_000);
    await send("Target.activateTarget", { targetId: E.targetId });
    await E.js(`probe.watch(${J(key)})`);
    const visibility = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      visibility.push(await D.js("document.visibilityState"));
      await sleep(1_000);
    }
    const watched = await E.js(`probe.states(${J(key)})`);
    await E.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    const last = await E.js(`probe.last(${J(key)})`);
    const hidden = visibility.filter((v) => v === "hidden").length;
    check(
      "9 a hidden holder tab keeps its run heard: a watcher in another tab never reads stalled",
      !watched.includes("stalled") && last.state === "succeeded" && hidden === visibility.length,
      `D read ${hidden} of ${visibility.length} seconds hidden; E's watcher read ${J(await E.js(`probe.states(${J(key)})`))}; ${last.state}`,
    );
  }

  // 10. served() in another tab lists this browser's pool
  {
    const pools = await E.js("probe.served(5000)");
    const mine = pools.find((p) => p.pool === poolId);
    check(
      "10 served() in another tab lists this browser's pool with its name and slots",
      !!mine && /^Chrome on macOS \(\w{4}\)$/.test(mine.name) && mine.slots === slots,
      `${J(pools)}`,
    );
  }

  // 11. the queue browser: the pools heard (this browser's marked), each task's runs, and a Stop that stops
  {
    const key = await E.js(`probe.ask(${J(SLEEP)}, { ms: 20000, value: 'eleven' })`);
    await E.waitFor(stateIs(key, "running"), 20_000);
    await E.js("probe.mountQueueView()");
    await E.waitFor("probe.queueView()?.tasks.some((t) => t.runs.length > 0 && t.stop) && probe.queueView().serving.length > 0", 15_000);
    const seen = await E.js("probe.queueView()");
    const pressed = await E.js("probe.pressStop()");
    await E.waitFor(stateIs(key, "cancelled", "failed", "succeeded"), GRACE_MS + 10_000);
    const last = await E.js(`probe.last(${J(key)})`);
    const run = seen.tasks.find((t) => t.runs.length > 0)?.runs[0] ?? "";
    check(
      "11 the queue browser marks this browser's pool, names a run's pool, and its Stop stops the task",
      seen.serving.some((line) => /Chrome on macOS \(\w{4}\)this browser/.test(line)) && /run by Chrome on macOS \(\w{4}\): openthis browser/.test(run) && pressed && last.state === "cancelled",
      `serving ${J(seen.serving)}; run line ${J(run)}; Stop pressed ${pressed}; then ${J(await E.js(`probe.states(${J(key)})`))}, runs ${J(runsOf(last))}`,
    );
  }
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
  if (DEBUG) {
    // what each pool's own Repo has of the queue and the tasks it lists
    for (const [id, w] of workers) {
      if (w.gone || !/pool-worker/.test(w.url)) continue;
      const r = await send("Runtime.evaluate", { expression: DUMP, awaitPromise: true, returnByValue: true }, id).catch((e) => ({ result: { value: String(e) } }));
      console.error("pool worker has:", r.result?.value ?? J(r.exceptionDetails));
    }
  }
}
if (workerLogs.length) console.error(`what workers said as errors (${workerLogs.length}):\n  ${workerLogs.slice(0, DEBUG ? 400 : 30).join("\n  ")}`);
stop(failed ? 1 : 0);
