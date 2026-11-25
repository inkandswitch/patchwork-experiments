// How a document travels between a task's run worker in a browser and the
// page that asked, through the real sync server: the browser half of
// probes/write-path.mjs. A throwaway Chrome profile opens a stand-in page
// (index.html, page.js) that loads the BUILT package from dist/, mounts what
// a frame mounts of it (its background component, which starts the page's
// pool, and its real titlebar tool) and presses Make my queue; the pool, its run workers and the page's Repos all use the real
// sync server, so a run worker's Repo (a database of its own) and the page's
// meet there. It measures and says what it saw; it checks nothing.
//
//   (in tasks/, after `pnpm build`)
//   /Users/pvh/dev/pwx-one/tools/slot.sh chrome -- node probes/write-path/browser.mjs
//       [--only out,in,ack] [--runs N] [--sizes 10k,1m,…] [--sync wss://…]
//
// The Repos are the site's as the page's import map names them, which this
// package carries as dev dependencies under `site-` names (as
// probes/browser-run.mjs does): plain Repos. The deployed site's own Repo is
// a keyhive Repo, which these are not.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { sleep } from "../cdp.mjs";
import { guardChrome, killChrome } from "../chrome-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 47931;
const CDP = 47932;
const J = JSON.stringify;
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? "wss://subduction.sync.inkandswitch.com";
const ONLY = (arg("--only") ?? "out,in,ack").split(",");
const KB = 1024;
const MB = 1024 * KB;
const parseSize = (s) => Math.round(parseFloat(s) * (/m$/i.test(s) ? MB : /k$/i.test(s) ? KB : 1));
const SIZES = arg("--sizes") ? arg("--sizes").split(",").map(parseSize) : [10 * KB, 100 * KB, MB, 5 * MB, 20 * MB];
const RUNS = arg("--runs") ? Number(arg("--runs")) : null;
const runsAt = (size) => RUNS ?? (size >= 20 * MB ? 1 : 3);
const LIMIT_MS = 120_000;
const TASK = "data:text/javascript," + encodeURIComponent(readFileSync(join(HERE, "task.js"), "utf8"));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);
const label = (size) => (size >= MB ? `${size / MB} MB` : `${size / KB} KB`);

if (!existsSync(join(PKG, "dist/index.js"))) {
  console.error("build the package first: pnpm build");
  process.exit(2);
}

// ── what is served: the built package, this page, and the site's modules ──
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "tasks-write-path-"));
const modules = join(PKG, "node_modules");
const siteRepo = realpathSync(join(modules, "site-automerge-repo"));
const siteModules = resolve(siteRepo, "../..");
const siteVersion = JSON.parse(readFileSync(join(siteRepo, "package.json"), "utf8")).version;
symlinkSync(join(PKG, "dist"), join(root, "dist"));
symlinkSync(HERE, join(root, "probe"));
symlinkSync(join(siteModules, "@automerge/automerge/dist/automerge.wasm"), join(root, "automerge.wasm"));
symlinkSync(join(siteModules, "@automerge/automerge-subduction/dist/automerge-subduction.wasm"), join(root, "subduction.wasm"));
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
  nodePaths: [siteModules, modules],
  logLevel: "warning",
  plugins: [
    {
      name: "leave-the-full-builds-out",
      setup(b) {
        b.onResolve({ filter: /^@automerge\/automerge(-subduction)?$/ }, ({ path }) => ({ path, external: true }));
      },
    },
  ],
});
const MIME = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ── Chrome ──
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "tasks-write-path-profile-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, "about:blank"], { stdio: "ignore", detached: true });
let stopped = false;
const stop = (code) => {
  if (stopped) return;
  stopped = true;
  killChrome(chrome);
  server.close();
  setTimeout(() => {
    for (const dir of [profile, root]) rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  }, 500);
};
guardChrome(chrome, { profile, stop });
setTimeout(() => (console.error("TIMEOUT"), stop(2)), 40 * 60_000).unref();

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
const said = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { ok, no, method } = pending.get(m.id);
    pending.delete(m.id);
    return m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
  }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "worker") {
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, m.params.sessionId).catch(() => {});
    send("Runtime.enable", {}, m.params.sessionId).catch(() => {});
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") said.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") said.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.slice(0, 300));
});
function send(method, params = {}, sessionId) {
  return new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no, method });
    ws.send(J({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
let exitCode = 0;
try {
  const { targetId } = await send("Target.createTarget", { url: `http://127.0.0.1:${PORT}/probe/index.html?sync=${encodeURIComponent(SYNC)}` });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  const js = async (expr, ms = 60_000) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId),
      sleep(ms).then(() => ({ exceptionDetails: { text: `no answer in ${ms} ms` } })),
    ]);
    if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  for (let t0 = Date.now(); !(await js("window.ready === true").catch(() => false)); await sleep(100)) {
    if (Date.now() - t0 > 30_000) throw new Error(`the page did not start: ${J(said)}`);
  }
  log(`Chrome ${version.Browser}; site Repo @chee/automerge-repo ${siteVersion}; sync ${SYNC}`);
  const queue = await js("probe.setUp()", 60_000);
  log(`own queue ${queue}; warm-up task ${await js("probe.warm()", 90_000)} ms`);

  const rows = [];
  const measure = async (kind, size, i, expr) => {
    const row = { kind, size, i, ...(await js(expr, 3 * LIMIT_MS).catch((e) => ({ ok: false, observed: e.message }))) };
    rows.push(row);
    console.log(J(row));
  };
  if (ONLY.includes("out")) for (const size of SIZES) for (let i = 0; i < runsAt(size); i++) await measure("out", size, i, `probe.out(${J(TASK)}, ${size}, false, ${LIMIT_MS})`);
  if (ONLY.includes("in")) for (const size of SIZES) for (let i = 0; i < runsAt(size); i++) await measure("in", size, i, `probe.in(${J(TASK)}, ${size}, ${LIMIT_MS})`);
  if (ONLY.includes("ack")) for (const size of SIZES) for (let i = 0; i < runsAt(size); i++) await measure("ack", size, i, `probe.out(${J(TASK)}, ${size}, true, ${LIMIT_MS})`);

  const table = [];
  for (const kind of ["out", "in", "ack"]) {
    for (const size of [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.size))]) {
      const of = rows.filter((r) => r.kind === kind && r.size === size);
      const ok = of.filter((r) => r.ok);
      const measureOf = kind === "in" ? (r) => r.taskMs : (r) => r.reachMs;
      table.push({
        kind,
        size: label(size),
        ask: ok.length ? `${median(ok.map((r) => r.askMs))} / ${Math.max(...ok.map((r) => r.askMs))}` : "-",
        arrive: ok.length ? `${median(ok.map(measureOf))} / ${Math.max(...ok.map(measureOf))}` : "-",
        failures: `${of.length - ok.length} of ${of.length}`,
        rejections: of.map((r) => r.rejections?.count ?? "?").join(","),
        ...(kind === "ack" ? { ackWait: ok.length ? `${median(ok.map((r) => r.ack?.ms ?? 0))} / ${Math.max(...ok.map((r) => r.ack?.ms ?? 0))}` : "-", acked: of.map((r) => (r.ack?.acked ? "y" : "n")).join("") } : {}),
      });
    }
  }
  console.error("\nmedian / worst ms; ask = asked to succeeded; arrive = succeeded to the page having it (out, ack) or the task's start to its having it (in)");
  console.table(table);
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  exitCode = 1;
}
if (said.length) console.error(`errors said by the page and its workers (${said.length}):\n  ${said.slice(0, 20).join("\n  ")}`);
stop(exitCode);
