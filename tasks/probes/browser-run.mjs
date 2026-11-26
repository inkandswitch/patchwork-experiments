// The browser's pool, proved on this machine without publishing anything: a
// throwaway Chrome profile opens tabs of a stand-in page (browser-run/) that
// loads the BUILT package from dist/, mounts what a frame mounts of it (its
// background component, which starts the page's pool host, found by its tag
// in the package's plugin list, and its real titlebar tool) and asks through
// the built task-client. Task
// code comes from data: URLs and from a file served here; the queue accepts
// any code. No sync server is reached but by checks 24 and 22: the pages' Repos and
// the pool's work from the profile's shared database, and each run worker's
// from a database of its own. So what a task writes through ctx.repo, which
// reaches the page only by the sync server, is not seen here (check 15 says
// so; real-run.mjs checks it), and a run that wrote something says so in its
// log (check 19). Check 22 runs probes/append-task.js, the task
// append-run.mjs runs on a Node host, unchanged, in a browser context of its
// own whose page and pool work through the real sync server (`--sync`, or
// PATCHWORK_SYNC, or Ink & Switch's), and watches the text it appends to grow
// in the page's Repo. Check 24 runs the same task in that context where it
// needs no sync server, on a document its run worker makes.
//
//   (in tasks/, after `pnpm build`)
//   /Users/pvh/dev/pwx-one/tools/slot.sh chrome -- node probes/browser-run.mjs [--show] [--no-network]
//
// --show runs Chrome in a visible window instead of headless (check 9 needs a
// page that the browser really hides; headless Chrome may not).
//
// --no-network runs with no network at all: Chrome resolves no host
// (`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`), so nothing
// beyond this machine can be reached, the sync server included. The one
// exception is 127.0.0.1, this process's server, which the rule would map
// too: it serves the pages, and stands in for the site's own origin (a
// service worker on the site). It first shows that the sync server's host cannot be reached
// from a page, and stops if it can. Every check runs as it does with the
// network but 22, which needs the sync server and is skipped, saying so.
// So it shows that a pool and its run workers start with nothing fetched
// from the network, that tasks run, and (24) that a task importing Automerge
// by bare name runs, with the sync server named but unreachable.
//
// What stands in for Patchwork: the site's modules (Repo, storage,
// automerge, subduction, solid), bundled here from this package's own
// node_modules and named in the page's import map as the site names them;
// automerge.wasm and subduction.wasm at the root; an account document, its
// handle where the site sets it, and the frame's tool-storage provider
// (page.js), which makes the account's task storage the first time a tool
// asks; and the page's tasks Repo, which the site would have. The account
// starts with no task storage (check 18); the probe's queue is then joined
// through the queue browser's Join, and checks 1 to 17 ask it. Checks 20
// and 21 run in a browser context of its own, where nothing mounts the
// background component until 21 does, and then lets it go. Check 23 runs
// on tab A's pool, after 19. Checks 24 and 22 run last, in a browser context
// of their own, in that order. A copy of dist/ stamped as a newer build is
// served at /dist-newer.
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
import { BEAT_MS, LISTEN_MS } from "../src/task-rules.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOW = process.argv.includes("--show");
// --debug: everything workers and pages log, not only their errors
const DEBUG = process.argv.includes("--debug");
// --no-network: no host name resolves (see the header)
const NO_NETWORK = process.argv.includes("--no-network");
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
// Each of these marks its worker before it spins, so the harness can tell which run worker is the spinning one.
const READS_WRITES_SPINS = dataUrl(
  "export default async (input, ctx) => { const task = await ctx.repo.find(ctx.taskUrl); const doc = ctx.repo.create({ wrote: input.tag, runsSeen: task.doc().runs.length }); doc.change((d) => { d.changed = true; }); await ctx.repo.flush(); ctx.log('wrote ' + doc.url); globalThis.spinning = true; for (;;) {} };",
);
const FLUSHES_SPINS = dataUrl(
  "export default (input, ctx) => { const doc = ctx.repo.create({ wrote: input.tag }); doc.change((d) => { d.changed = true; }); ctx.repo.flush(); globalThis.spinning = true; for (;;) {} };",
);
const WRITES = dataUrl(
  "export default async (input, ctx) => { const doc = ctx.repo.create({ wrote: input.tag }); doc.change((d) => { d.changed = true; }); await ctx.repo.flush(); await new Promise((r) => setTimeout(r, input.ms)); return doc.url; };",
);
// awaits ctx.settled, and says when it resolved, or why it rejected; then waits `holdMs`
const SETTLES = dataUrl(
  "export default async ({ holdMs }, ctx) => { try { await ctx.settled; } catch (error) { ctx.log(error.message); return { settled: false }; } const at = Date.now(); ctx.log('settled at ' + at); await new Promise((r) => setTimeout(r, holdMs)); return { settled: true, at }; };",
);
const SLEEP = `http://127.0.0.1:${PORT}/probe/tasks/sleep.js`;
// the task append-run.mjs runs on a Node host, served as it is
const APPEND = `http://127.0.0.1:${PORT}/append-task.js`;
// that task, unchanged, on a document of its run worker's own (check 24)
const APPEND_ALONE = `http://127.0.0.1:${PORT}/probe/tasks/append-alone.js`;
const SYNC_SERVER = (() => {
  const at = process.argv.indexOf("--sync");
  return (at > 0 && process.argv[at + 1]) || process.env.PATCHWORK_SYNC || "wss://subduction.sync.inkandswitch.com";
})();

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
symlinkSync(join(HERE, "append-task.js"), join(root, "append-task.js"));
symlinkSync(join(HERE, "append-check.js"), join(root, "append-check.js"));
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
  [
    SHOW ? "" : "--headless=new",
    // every host unresolvable but the address this process serves the pages from
    NO_NETWORK ? "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1" : "",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP}`,
    "--window-size=1000,700",
    "about:blank",
  ].filter(Boolean),
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
/** What the pages logged as errors (check 16 looks for the pool host's). */
const pageErrors = [];
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
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error" && !workers.has(m.sessionId))
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
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
/**
 * The live run workers of one tab whose task's code is spinning: those that
 * say they are (the probe's spinning tasks set `globalThis.spinning`; DevTools
 * can still evaluate in a spinning worker), or that do not answer at all.
 */
async function spinningRunWorkers(tab) {
  const spinning = [];
  for (const id of liveWorkers(tab, /run-worker-entry/)) {
    const said = await Promise.race([
      send("Runtime.evaluate", { expression: "globalThis.spinning === true", returnByValue: true }, id).then((r) => r.result?.value === true, () => false),
      sleep(1_000).then(() => "silent"),
    ]);
    if (said === true || said === "silent") spinning.push(id);
  }
  return spinning;
}
/** Resolves once every worker in `ids` has gone, or at `until`. */
const allGone = (ids, until) =>
  new Promise((r) => {
    const look = () => (ids.every((id) => workers.get(id).gone) || Date.now() > until ? r() : setTimeout(look, 50));
    look();
  });

async function tab(label, path = "/probe/index.html", browserContextId) {
  const { targetId } = await send("Target.createTarget", { url: `${base}${path}`, background: false, ...(browserContextId ? { browserContextId } : {}) });
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
  // Whether a page reaches beyond this machine, tried on the sync server's host.
  {
    const host = new URL(SYNC_SERVER.replace(/^ws/, "http")).origin;
    const reached = await A.js(
      `fetch(${J(host)}, { mode: 'no-cors', signal: AbortSignal.timeout(10_000) }).then(() => 'reached', (error) => 'not reached: ' + error.message)`,
      15_000,
    );
    log(`the network: ${host} from a page, ${reached}${NO_NETWORK ? " (--no-network)" : ""}`);
    if (NO_NETWORK && reached === "reached") throw new Error(`--no-network, but a page reached ${host}`);
  }
  await A.js("probe.makeAccount()");
  // The pool starts only once a queue is served, which check 18 brings about.
  await A.js("probe.mount()");
  const slots = await A.js("Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))");
  let poolId;

  // 18 (first, while the account is fresh). An account that names no task
  // storage serves nothing, and its titlebar says so and offers a queue of
  // one's own; pressing that makes the storage (through the provider) and a
  // queue, serves it, and a task asked of ownQueue() runs. Then the probe's
  // queue is joined through the queue browser's Join, which checks 1 to 17
  // ask, and a task asked of it before the join, which waited, runs.
  {
    const said = await A.waitFor("probe.titlebar()?.offer === 'make' && probe.titlebar()", 15_000);
    const hostBefore = await A.js("probe.status()");
    const storageBefore = await A.js("probe.storage()");
    const waitingKey = await A.js(`probe.ask(${J(NOOP)})`);
    const heard = await A.js("probe.served(4000)");
    const waited = await A.js(`probe.last(${J(waitingKey)})`);
    const pressed = await A.js("probe.pressMakeOwn()");
    const own = await A.waitFor("probe.ownNow().then((url) => url ?? false)", 15_000);
    const servedAfter = await A.js("probe.servedNow()");
    const ownRun = await A.js(`probe.ownQueue().then((url) => probe.timeRun(${J(NOOP)}, null, url).then((r) => ({ url, ...r })))`, 30_000).catch((e) => ({ error: String(e.message ?? e) }));
    const asked = await A.js("probe.providerAsked");
    const offerAfter = await A.waitFor("probe.titlebar()?.offer === null && probe.titlebar()", 10_000);
    const joined = await A.js("probe.join()");
    await A.waitFor(stateIs(waitingKey, "succeeded", "failed", "cancelled"), 20_000);
    const afterJoin = await A.js(`probe.last(${J(waitingKey)})`);
    check(
      "18 a fresh account serves nothing and says so; Make my queue makes and serves one, and a task asked of ownQueue() runs; Join serves the probe's queue and its waiting task runs",
      !!said && /No task queues/.test(said.text) && hostBefore?.state === "serves nothing" && storageBefore === null && heard.length === 0 && waited.state === "waiting" && waited.runs.length === 0 &&
        pressed && typeof own === "string" && servedAfter?.[own] === true && J(Object.keys(servedAfter)) === J([own]) &&
        ownRun.url === own && ownRun.result === 1 && J(asked) === J(["tasks-next"]) && !!offerAfter &&
        joined.pressed && joined.served === true && afterJoin.state === "succeeded",
      `before: titlebar ${J(said?.text)} offering ${J(said?.offer)}, host ${J(hostBefore?.state)}, task storage ${J(storageBefore)}, pools heard on the probe's queue ${J(heard)}, a task asked of it ${waited.state} with ${waited.runs.length} runs; pressed ${pressed}; after: own ${String(own).slice(0, 22)}…, served ${J(Object.keys(servedAfter ?? {}).map((u) => u.slice(0, 22)))}, the provider asked for ${J(asked)}; a task asked of ownQueue() ${ownRun.result === 1 ? `ran in ${ownRun.ms.toFixed(0)} ms on ${ownRun.url === own ? "that queue" : J(ownRun.url)}` : J(ownRun)}; titlebar then ${J(offerAfter?.text)}; Join pressed ${joined.pressed}, served ${J(joined.served)}; the waiting task ${afterJoin.state}`,
    );
  }
  if (!(await A.waitFor("probe.status()?.state === 'running'", 30_000))) {
    throw new Error(`tab A's pool did not start: ${J(await A.js("probe.status()"))} ${J(workerLogs)}`);
  }
  poolId = await A.js("localStorage.getItem('patchwork-tasks-pool-id')");
  log(`A runs pool ${poolId}, ${slots} slots`);
  // A pool takes nothing until it has listened to a queue for a beat and a
  // little (LISTEN_MS), so the timed checks begin after that.
  await sleep(LISTEN_MS);

  // 1. a do-nothing task, ask to result, ten in a row
  {
    const first = await A.js(`probe.timeRun(${J(NOOP)})`);
    const times = [];
    for (let i = 0; i < 10; i++) times.push((await A.js(`probe.timeRun(${J(NOOP)})`)).ms);
    check(
      "1 a do-nothing task, ten in a row",
      times.length === 10,
      `first (starts a run worker) ${first.ms.toFixed(0)} ms; then median ${median(times).toFixed(1)} ms, worst ${Math.max(...times).toFixed(1)} ms`,
    );
  }

  // 19. A task that writes a document through ctx.repo, with no sync server
  // to reach (this harness's Repos point at ws://127.0.0.1:9): its run
  // worker waits for nothing, and the run's log says that what it wrote
  // stays on this machine. Timed as check 1 is.
  {
    const times = [];
    for (let i = 0; i < 10; i++) times.push((await A.js(`probe.timeRun(${J(WRITES)}, ${J({ tag: `nineteen-${i}`, ms: 0 })})`)).ms);
    const key = await A.js(`probe.ask(${J(WRITES)}, ${J({ tag: "nineteen", ms: 0 })})`);
    await A.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    const last = await A.js(`probe.last(${J(key)})`);
    const kept = last.runs.at(-1)?.logs ?? [];
    check(
      "19 a task that writes a document through ctx.repo, with no sync server: it completes at once, and its run's log says what it wrote stays on this machine",
      last.state === "succeeded" && kept.some((line) => /stays on this machine/.test(line)) && Math.max(...times) < 1_000,
      `ten in a row: median ${median(times).toFixed(1)} ms, worst ${Math.max(...times).toFixed(1)} ms; then ${last.state}, its run's log ${J(kept)}`,
    );
  }

  // 23. ctx.settled in a browser's run worker: a run that nothing stops is
  // told it settled no sooner than a beat after its run was recorded; a run
  // stopped within the beat (the page cancels it the moment it reads it
  // running) has it reject, saying `cancelled`, and is never told it settled.
  {
    const key = await A.js(`probe.ask(${J(SETTLES)}, ${J({ holdMs: 0 })})`);
    await A.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    const ran = await A.js(`probe.last(${J(key)})`);
    const run = ran.runs.find((r) => r.status === "succeeded");
    const after = ran.result?.settled && run ? ran.result.at - run.start : null;
    const stopped = await A.js(
      `(async () => {
        const key = await probe.ask(${J(SETTLES)}, ${J({ holdMs: 5_000 })});
        await new Promise((resolve) => { const look = () => (probe.last(key)?.state === 'running' ? resolve() : setTimeout(look, 5)); look(); });
        await probe.cancel(key);
        return { key, cancelledAt: Date.now() };
      })()`,
      30_000,
    );
    await A.waitFor(stateIs(stopped.key, "cancelled", "failed", "succeeded"), GRACE_MS + 10_000);
    const last = await A.js(`probe.last(${J(stopped.key)})`);
    const mine = last.runs.find((r) => r.pool);
    const lines = mine?.logs ?? [];
    const rejected = lines.some((l) => /^the run stopped before it settled \(cancelled\)$/.test(l));
    const toldSettled = lines.some((l) => /^settled at /.test(l));
    check(
      `23 ctx.settled in a run worker resolves no sooner than BEAT_MS (${BEAT_MS} ms) after the run was recorded; for a run stopped within the beat it rejects, cancelled`,
      after !== null && after >= BEAT_MS && rejected && !toldSettled && mine?.status === "cancelled",
      `resolved ${after} ms after its run was recorded (${ran.state}); the stopped one cancelled ${mine ? stopped.cancelledAt - mine.start : "?"} ms after its run was recorded, recorded ${mine?.status}, its lines ${J(lines)}, states ${J(await A.js(`probe.states(${J(stopped.key)})`))}`,
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
      locks.held === 1 && locks.pending === 1 && locks.workerHeld === 1 && locks.workerPending === 0 && (await A.js("probe.status().state")) === "running" && badge?.state === "waiting" && /another tab/.test(badge.text) && pools.A === 1 && pools.B === 0 && fromB.result === 1,
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
      took < 5_000 && last.state === "succeeded" && J(runsOf(last)) === J(["lost", "succeeded"]) && (!restored || back === "waiting") && (await C.js("probe.status().state")) === "running" && locks.held === 1 && locks.workerHeld === 1,
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

  // 12. the holder frozen (as the browser freezes a background tab), not left:
  // it lets go, another tab of its build takes over, and on resuming it waits
  let F;
  {
    F = await tab("F"); // the newer build, as D is, so that it does not stand down for D
    await F.js("probe.mount('/dist-newer')");
    await F.waitFor("probe.status()?.state === 'waiting'", 15_000);
    const key = await F.js(`probe.ask(${J(SLEEP)}, { ms: 4000, value: 'twelve' })`);
    await F.waitFor(stateIs(key, "running"), 20_000);
    await sleep(1_000);
    const t0 = Date.now();
    await send("Page.setWebLifecycleState", { state: "frozen" }, D.sessionId);
    await F.waitFor("probe.status()?.state === 'running'", 30_000, 10);
    const took = (await F.js("probe.statusLog.find((s) => s.state === 'starting' || s.state === 'running')?.t")) - t0;
    await F.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 30_000);
    const last = await F.js(`probe.last(${J(key)})`);
    const poolsWhileFrozen = { D: liveWorkers(D, /pool-worker/).length, F: liveWorkers(F, /pool-worker/).length };
    await send("Page.setWebLifecycleState", { state: "active" }, D.sessionId);
    const dBack = await D.waitFor("probe.status()?.state === 'waiting' && probe.status().state", 10_000);
    const locks = await F.js("probe.locks()");
    check(
      "12 the holding tab frozen mid-run: it lets go at once, the other tab's pool (same id) records the run lost and runs it again; resumed, it waits",
      took < 5_000 && last.state === "succeeded" && J(runsOf(last)) === J(["lost", "succeeded"]) && last.runs.every((run) => run.pool === poolId) && poolsWhileFrozen.D === 0 && poolsWhileFrozen.F === 1 && dBack === "waiting" && locks.held === 1 && locks.pending >= 1 && locks.workerHeld === 1,
      `F took the lock ${took} ms after the freeze; runs ${J(runsOf(last))}, ${last.state} ${J(last.result)}; pool workers while frozen D ${poolsWhileFrozen.D}, F ${poolsWhileFrozen.F}; D resumed reads ${J(dBack)}; locks ${J(locks)}`,
    );
  }

  // 13 and 14. A task that has used ctx.repo spins, its worker's Repo
  // perhaps in the middle of a write. Every run worker keeps its documents in
  // a database of its own, so what its blocked thread holds open holds up
  // nobody else: the page's stop is saved at once, the pool hears it and ends
  // the worker GRACE_MS later (gone about 2 s after that), and the next task
  // runs. (With every Repo on one database, the page's save of the stop
  // waited on the spinning worker for over a minute.)
  const spinThenCancel = async (importUrl, tag) => {
    const key = await F.js(`probe.ask(${J(importUrl)}, ${J({ tag })})`);
    await F.waitFor(stateIs(key, "running"), 20_000);
    await sleep(500);
    const spinning = await spinningRunWorkers(F);
    const t0 = Date.now();
    const saved = await F.js(`probe.cancel(${J(key)})`, 20_000).then(
      () => Date.now() - t0,
      (e) => `not in ${Date.now() - t0} ms (${e.message})`,
    );
    await F.waitFor(stateIs(key, "cancelled", "failed", "succeeded"), GRACE_MS + 10_000);
    await allGone(spinning, t0 + GRACE_MS + 5_000);
    const goneIn = spinning.map((id) => (workers.get(id).gone ? workers.get(id).gone - t0 : null));
    const views = await F.js(`probe.views[${J(key)}]`);
    const stopping = views.find((v) => v.state === "stopping");
    const last = views.at(-1);
    const run = last.runs.find((r) => r.pool);
    const next = await F.js(`probe.timeRun(${J(NOOP)})`).catch((e) => ({ error: String(e.message ?? e) }));
    const outcome = {
      spinning: spinning.length,
      saved,
      stoppingIn: stopping ? stopping.t - t0 : null,
      recordedIn: run?.end ? run.end - t0 : null,
      goneIn,
      states: await F.js(`probe.states(${J(key)})`),
      run,
      next,
    };
    outcome.ok =
      spinning.length === 1 &&
      typeof saved === "number" && saved <= 1_500 &&
      outcome.stoppingIn !== null && outcome.stoppingIn <= 1_500 &&
      last.state === "cancelled" && run?.status === "cancelled" &&
      goneIn.every((ms) => ms !== null && ms <= GRACE_MS + 3_000) &&
      next.result === 1;
    outcome.line = `${spinning.length} run worker(s) spinning at the cancel; the stop saved ${typeof saved === "number" ? `${saved} ms` : saved} after asking; read stopping after ${outcome.stoppingIn} ms; states ${J(outcome.states)}; the run recorded ${run?.status} ${outcome.recordedIn} ms after the cancel; its worker gone after ${J(goneIn)} ms (bound ${GRACE_MS + 3_000}); next task ${next.result === 1 ? `ran in ${next.ms.toFixed(0)} ms` : J(next)}`;
    return outcome;
  };
  {
    const out = await spinThenCancel(READS_WRITES_SPINS, "thirteen");
    const wrote = (out.run?.logs ?? []).find((line) => /^wrote automerge:/.test(line));
    check(
      "13 a task that read and wrote through ctx.repo (find, create, change, flush) and then spins: the stop is saved and heard at once, its worker is gone GRACE + 2 s later, the next task runs",
      out.ok && !!wrote,
      `its record says ${J(wrote ?? "(no 'wrote' line)")}; ${out.line}`,
    );
  }
  {
    const out = await spinThenCancel(FLUSHES_SPINS, "fourteen");
    check(
      "14 a task that changes a document, starts a flush and spins at once, never awaiting: the same",
      out.ok,
      out.line,
    );
  }

  // 15. Two tasks at once, in two run workers, each writing a document of its
  // own through ctx.repo. Shown: both run at once, each holding its own
  // database's lock; each result and record reaches the page (the pool writes
  // those); each document is stored in exactly one run worker's database, a
  // different one for each, and not in the shared one. NOT shown: that the
  // documents reach the page. They go by the sync server, and this harness
  // has none (its Repos point at ws://127.0.0.1:9), so the page cannot have
  // them here, and the check says that it does not. probes/real-run.mjs
  // checks the documents arrive, against the real server.
  {
    const keys = [];
    for (const tag of ["fifteen-a", "fifteen-b"]) keys.push(await F.js(`probe.ask(${J(WRITES)}, ${J({ tag, ms: 3_000 })})`));
    await F.waitFor(keys.map((k) => stateIs(k, "running")).join(" && "), 20_000);
    await sleep(1_000);
    const during = (await F.js("probe.locks()")).runHeld;
    for (const k of keys) await F.waitFor(stateIs(k, "succeeded", "failed", "cancelled"), 20_000);
    const lasts = [];
    for (const k of keys) lasts.push(await F.js(`probe.last(${J(k)})`));
    const urls = lasts.map((l) => l.result);
    const stored = [];
    const pageHas = [];
    for (const url of urls) {
      const ok = typeof url === "string" && url.startsWith("automerge:");
      stored.push(ok ? await F.js(`probe.storedIn(${J(url)})`) : null);
      pageHas.push(ok ? await F.js(`probe.has(${J(url)}, 2000)`) : null);
    }
    const homes = stored.map((s) => s?.found ?? []);
    check(
      "15 two tasks at once in two run workers, each writing its own document: both run, each document is stored in its own worker's database only; results and records reach the page (documents reaching the page through the sync server: NOT exercised here)",
      lasts.every((l) => l.state === "succeeded" && J(runsOf(l)) === J(["succeeded"])) &&
        new Set(urls).size === 2 &&
        during.length >= 2 &&
        homes.every((h) => h.length === 1 && /^patchwork-tasks-run-\d+$/.test(h[0])) &&
        homes[0][0] !== homes[1][0] &&
        pageHas.every((has) => has === false),
      `run locks held while both ran ${J(during)}; ${lasts.map((l, i) => `${l.state} ${J(runsOf(l))} → ${String(urls[i]).slice(0, 22)}… stored in ${J(homes[i])}`).join("; ")}; task databases ${J(stored[0]?.databases)}; the page's Repo has the documents: ${J(pageHas)} (expected false: no sync server here). That a document a task writes reaches the page is NOT shown by this harness; real-run.mjs checks it.`,
    );
  }

  // 16. An error that escapes the pool's worker after it is ready is logged,
  // and the pool goes on.
  {
    const [pool] = liveWorkers(F, /pool-worker/);
    const from = await F.js("probe.statusLog.length");
    const errorsFrom = pageErrors.length;
    await send("Runtime.evaluate", { expression: "setTimeout(() => { throw new Error('thrown on purpose in the pool worker'); }, 0), true", returnByValue: true }, pool);
    await sleep(3_000);
    const states = await F.js(`probe.statusLog.slice(${from}).map((s) => s.state)`);
    const logged = pageErrors.slice(errorsFrom).find((line) => /pool hit an error, and goes on.*thrown on purpose/.test(line));
    const next = await F.js(`probe.timeRun(${J(NOOP)})`).catch((e) => ({ error: String(e.message ?? e) }));
    const pools = liveWorkers(F, /pool-worker/);
    check(
      "16 an error escaping the pool's worker once it is ready is logged; the pool goes on",
      !!logged && !states.includes("unavailable") && (await F.js("probe.status().state")) === "running" && J(pools) === J([pool]) && next.result === 1,
      `the page logged ${J(logged ?? "(nothing)")}; states since ${J(states)}; the same pool worker ${J(pools) === J([pool]) ? "lives" : `is gone (${pools.length} now)`}; next task ${next.result === 1 ? `ran in ${next.ms.toFixed(0)} ms` : J(next)}`,
    );
  }

  // 17. A pool's worker that has died says nothing; its page notices by its
  // silence, ends it and lets the lock go, and the tab waiting takes over.
  {
    const [pool] = liveWorkers(F, /pool-worker/);
    const t0 = Date.now();
    await send("Runtime.evaluate", { expression: "setTimeout(() => self.close(), 0), true", returnByValue: true }, pool).catch(() => {});
    const problem = await F.waitFor("probe.status()?.state === 'unavailable' && probe.status().problem", 45_000, 200);
    const noticedIn = Date.now() - t0;
    const taken = await D.waitFor("probe.status()?.state === 'running'", 15_000, 50);
    const next = await D.js(`probe.timeRun(${J(NOOP)})`).catch((e) => ({ error: String(e.message ?? e) }));
    // The first status request after the close starts the count (up to a
    // beat later); the first one after 30 s of silence ends it (up to a beat
    // more); and a little for timers and this harness's polling.
    const bound = 30_000 + 2 * 2_000 + 3_000;
    check(
      "17 a pool's worker that dies is noticed by its silence; the lock passes to the waiting tab, whose pool runs the next task",
      /not answered/.test(problem || "") && noticedIn <= bound && !!taken && next.result === 1,
      `F read ${J(problem)} ${noticedIn} ms after its pool's worker closed itself (bound ${bound}); D ${taken ? "runs the pool" : `reads ${J(await D.js("probe.status()"))}`}; next task ${next.result === 1 ? `ran in ${next.ms.toFixed(0)} ms` : J(next)}`,
    );
  }

  // 20. A frame that mounts only the badge, and not the background
  // component, runs no pool, and the badge and the queue browser say so and
  // why. In a browser context of its own (its own storage and locks), so
  // that no tab above can be serving: a queue joined there, a task asked of
  // it waits, and nothing holds or waits for the pool's lock.
  {
    const { browserContextId } = await send("Target.createBrowserContext", {});
    const Z = await tab("Z", "/probe/index.html", browserContextId);
    await Z.js("probe.makeAccount()");
    const joined = await Z.js("probe.join()");
    await Z.js("probe.mount('/dist', { background: false })");
    const badge = await Z.waitFor("probe.badge()?.state && probe.badge()", 15_000);
    const key = await Z.js(`probe.ask(${J(NOOP)})`);
    const heard = await Z.js("probe.served(4000)");
    const task = await Z.js(`probe.last(${J(key)})`);
    await Z.js("probe.mountQueueView()");
    const view = await Z.waitFor("probe.queueView()?.here && probe.queueView()", 15_000);
    const locks = await Z.js("probe.locks()");
    const status = await Z.js("probe.status()");
    const poolWorkers = liveWorkers(Z, /pool-worker/).length;
    check(
      "20 with only the badge mounted, no pool runs, and the badge and the queue browser say so and why",
      !!joined?.served && status === null && locks.held === 0 && locks.pending === 0 && locks.workerHeld === 0 && poolWorkers === 0 &&
        heard.length === 0 && task?.state === "waiting" &&
        badge?.state === "not started" && /not running here/.test(badge.text) && /nothing in this frame has started it/.test(badge.title) &&
        view?.here?.state === "not started" && /nothing in this frame has started it/.test(view.here.text),
      `joined ${J(joined)}; host ${J(status)}; locks ${J(locks)}; pool workers ${poolWorkers}; pools heard ${heard.length}; the task ${task?.state}; badge ${J(badge)}; queue browser ${J(view?.here)}`,
    );

    // 21. The background component mounted later: the page takes the lock,
    // the waiting task runs, and the badge says so without being mounted
    // again. Then let go, as a frame that goes away lets go: the pool lets
    // the lock go, and the badge says the page has no part in it again.
    const mounted = await Z.js("probe.mountBackground()");
    const running = await Z.waitFor("probe.status()?.state === 'running'", 30_000);
    await Z.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 20_000);
    const ran = await Z.js(`probe.last(${J(key)})`);
    const badgeRunning = await Z.waitFor("probe.badge()?.state === 'running' && probe.badge()", 10_000);
    await Z.js("probe.unmountBackground()");
    const idle = await Z.waitFor("probe.status()?.state === 'not started' && probe.status()", 15_000);
    const locksAfter = await Z.js("probe.locks()");
    const badgeAfter = await Z.waitFor("probe.badge()?.state === 'not started' && probe.badge()", 10_000);
    // The page ends the pool's worker before it says "not started", but
    // DevTools reports the worker gone a moment later, so this waits for that
    // report, up to a bound, and says how long it took.
    const idleAt = Date.now();
    while (liveWorkers(Z, /pool-worker/).length > 0 && Date.now() - idleAt < 5_000) await sleep(50);
    const poolWorkersAfter = liveWorkers(Z, /pool-worker/).length;
    const workerGoneMs = Date.now() - idleAt;
    check(
      "21 the background component mounted later starts the pool and the badge follows; let go, the pool lets the lock go and the badge says so",
      mounted === 1 && !!running && ran?.state === "succeeded" && badgeRunning?.state === "running" &&
        !!idle && locksAfter.held === 0 && locksAfter.workerHeld === 0 && poolWorkersAfter === 0 && /not running here/.test(badgeAfter?.text ?? ""),
      `background components ${mounted}; running ${!!running}; the waiting task ${ran?.state}; badge ${J(badgeRunning?.text)}; after letting go: host ${J(idle?.state)}, locks ${J(locksAfter)}, pool workers ${poolWorkersAfter} (looked for ${workerGoneMs} ms after the host said not started, bound 5000), badge ${J(badgeAfter?.text)}`,
    );
    await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }

  // 24 and 22, in a browser context of its own whose page, pool and run
  // workers name the real sync server (with --no-network, one they cannot
  // reach). The pool starts there, and probes/append-task.js runs unchanged.
  {
    const pieces = ["Once ", "upon ", "a ", "time, ", "the ", "text ", "grew ", "by ", "appends."];
    const sums = pieces.map((_, k) => pieces.slice(0, k + 1).join("").length).slice(0, -1);
    const { browserContextId } = await send("Target.createBrowserContext", {});
    try {
      const S = await tab("S", `/probe/index.html?sync=${encodeURIComponent(SYNC_SERVER)}`, browserContextId);
      await S.js("probe.makeAccount()");
      const joined = await S.js("probe.join()");
      await S.js("probe.mount()");
      const running = await S.waitFor("probe.status()?.state === 'running'", 30_000);

      // 24. Where it needs no sync server: the pool starts, a do-nothing task
      // runs, and append-task.js, which imports Automerge's splice by bare
      // name through the page's import map, appends each piece to a text its
      // run worker made (probe/tasks/append-alone.js).
      {
        await sleep(LISTEN_MS);
        const noop = await S.js(`probe.timeRun(${J(NOOP)})`, 30_000).catch((e) => ({ error: String(e.message ?? e) }));
        const key = await S.js(`probe.ask(${J(APPEND_ALONE)}, ${J({ pieces, everyMs: 100 })})`);
        await S.waitFor(stateIs(key, "succeeded", "failed", "cancelled"), 60_000);
        const last = await S.js(`probe.last(${J(key)})`);
        const kept = last?.runs.at(-1)?.logs ?? [];
        check(
          `24 where it needs no sync server${NO_NETWORK ? " (none reachable: --no-network)" : ""}: the pool starts, a do-nothing task runs, and append-task.js, importing Automerge by bare name, appends each piece to a text its run worker made`,
          !!running && !!joined?.served && noop.result === 1 && last?.state === "succeeded" && last.result?.appended === pieces.length && last.result?.text === pieces.join(""),
          `pool running ${!!running}, joined ${J(joined)}; a do-nothing task ${noop.result === 1 ? `ran in ${noop.ms.toFixed(0)} ms` : J(noop)}; append-task.js ${last?.state}, returned ${J(last?.result)}${last?.error ? `, error ${J(last.error)}` : ""}, its run's log ${J(kept)}`,
        );
      }

      // 22. Text streamed into a document from a browser's run worker:
      // probes/append-task.js, unchanged from the Node host's, imports
      // Automerge's splice by bare name through the page's import map and
      // appends each piece to the end of a text the page made, which reaches
      // the run worker, and what it appends the page, through the sync
      // server; read as append-run.mjs reads it (probes/append-check.js).
      if (NO_NETWORK) {
        console.error(`skip 22 a browser's run worker appends to a text the page made, seen to grow in the page: it needs the sync server (${SYNC_SERVER}), and --no-network reaches none`);
      } else {
        const got = await S.js(`probe.append(${J(APPEND)}, ${J(pieces)}, 400)`, 120_000);
        check(
          `22 a browser's run worker runs append-task.js unchanged, through the page's import map, appending each piece to the end of a text the page sees grow (through ${SYNC_SERVER})`,
          !!running && !!joined?.served && got.result === pieces.length && got.atEnd === pieces.join("") && got.well,
          `pool running ${!!running}, joined ${J(joined)}; returned ${J(got.result)} in ${got.ms.toFixed(0)} ms, the first piece seen after ${got.firstMs === null ? "never" : `${got.firstMs.toFixed(0)} ms`}; text when the ending was heard ${J(got.atEnd)}; the task's changes ${got.changes} for ${pieces.length} pieces, ${got.endAppends} of them appends at the end${got.notAppend ? `, first not: ${J(got.notAppend)}` : ""}; every text seen a run of whole pieces from the start: ${got.prefixes}; lengths seen on the way ${J(got.between)} of ${J(sums)}`,
        );
      }
    } finally {
      await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    }
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
