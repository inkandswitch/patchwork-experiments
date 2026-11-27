// The session task (runners/session-task.js) in a browser pool's run worker,
// on the tasks package's stand-in page: step 3b of notes/SPEC-AGENT.md, the
// chrome slot's part.
//
//   (in the chrome slot, after `pnpm build` in tasks/) node probes/session-task-browser.mjs [--sync wss://…] [--show]
//
// The page is the one tasks/probes/browser-run.mjs drives (index.html and
// page.js under tasks/probes/browser-run, the built package at /dist, the
// site's modules bundled to /vendor under the names the site's import map
// gives them), served here as files, with this directory beside them at
// /agent. In a throwaway Chrome profile, in a browser context whose page,
// pool and run workers name the real sync server, the page makes an account,
// joins its queue and mounts the pool, as browser-run's check 22 does; then
// it makes a session and asks for /agent/runners/session-task.js with the
// tasks client's run(). The page's registry has the Tasks package, from its
// built entry, as a page where it is installed does. The model is a stand-in served at /provider on the
// same origin (probes/stand-in-provider.mjs), with a made-up key.
//
// A scratch package (a made-up url at heads, its files served here at the
// paths the site's service worker serves a package kept in automerge at) is
// installed in the page as core's page installs one, as tasks/probes/
// browser-run.mjs's checks 43 to 50 do: it registers two agent tools, one
// declared for a worker and one for a page, each answering with the realm
// that ran it. The page's registry reaches the pool's run workers by the
// tasks package's snapshot; the burst finds both tools there.
//
// Checks, one line each:
//   1 the session task runs in the browser's run worker and answers { outcome, heads, own }
//   2 it imports Automerge by bare name there (host/modules.js), resolved by the page's import map,
//     and asks the run worker's registry for the task client (host/import.js) to read its task's runs
//   3 the text streams into the page's copy of the session, piece by piece
//   4 a burst offers the scratch package's two tools, from its run worker's registry; its input
//     carries nothing of them
//   5 the stand-in model calls both: the worker tool runs in the burst, in the run worker, and its
//     result lands in the session
//   6 the page tool's call parks; the page runs it (runners/page.js pageCalls, the page's
//     registry), and the next burst carries on to the model's last words
//
// Chrome, the server and the files are gone at the end, pass or fail.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { standInHandler } from "./stand-in-provider.mjs";
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import { initSession } from "../session/schema.js";
import { makeTurn, textBlock } from "../session/blocks.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = resolve(HERE, "..");
const TASKS = resolve(AGENT, "../tasks");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOW = process.argv.includes("--show");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const SCRATCH = arg("--scratch") ?? process.env.PROBE_SCRATCH ?? tmpdir();
const PORT = 47931;
const CDP = 47932;
const LISTEN_MS = 2_500;
const MODEL_KEY = "made-up-model-key-browser-5e19";
const PIECES = ["Streamed ", "from ", "a ", "run ", "worker, ", "piece ", "by ", "piece."];

const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : J(saw)}`);
};

if (!existsSync(join(TASKS, "dist/index.js"))) {
  console.error("build the tasks package first: pnpm build in tasks/");
  process.exit(2);
}

// ── what is served: the tasks package's stand-in page, as browser-run.mjs lays it out, and this package at /agent ──
mkdirSync(SCRATCH, { recursive: true });
const root = mkdtempSync(join(SCRATCH, "session-task-browser-"));
const modules = join(TASKS, "node_modules");
const siteModules = resolve(realpathSync(join(modules, "site-automerge-repo")), "../..");
symlinkSync(join(TASKS, "dist"), join(root, "dist"));
symlinkSync(join(TASKS, "probes/browser-run"), join(root, "probe"));
symlinkSync(AGENT, join(root, "agent"));
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
  "patchwork-plugins": "@inkandswitch/patchwork-plugins",
  "patchwork-filesystem": "@inkandswitch/patchwork-filesystem",
};
const entryPoints = {};
for (const [name, spec] of Object.entries(vendor)) {
  writeFileSync(join(stubs, `${name}.js`), `export * from ${J(spec)};\n`);
  entryPoints[name] = join(stubs, `${name}.js`);
}
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

// ── the scratch package: two agent tools, each saying which realm ran it ──
const PKG = stringifyAutomergeUrl({ documentId: parseAutomergeUrl(generateAutomergeUrl()).documentId, heads: encodeHeads(["c".repeat(64)]) });
const TOOLS = [
  { type: "agent:tool", id: "probe_realm_worker", name: "Realm (worker)", description: "Say which realm runs this tool.", where: "worker", risk: "read", input_schema: { type: "object", properties: {} } },
  { type: "agent:tool", id: "probe_realm_page", name: "Realm (page)", description: "Say which realm runs this tool, from a page.", where: "host", risk: "read", input_schema: { type: "object", properties: {} } },
];
const realmCode = `export default { execute: async () => "ran in " + (globalThis.constructor?.name ?? "?") + " at " + (globalThis.location?.pathname ?? "?") };\n`;
const scratch = new Map([
  [
    PKG,
    {
      "package.json": J({ name: "probe-realm-tools", type: "module", main: "index.js" }),
      "index.js": `export const plugins = ${J(TOOLS)}.map((t) => ({ ...t, load: () => import(t.where === "worker" ? "./worker.js" : "./page.js").then((m) => m.default) }));\n`,
      "worker.js": realmCode,
      "page.js": realmCode,
    },
  ],
]);
const TOOL_SESSION = "Run both realm tools.";

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".map": "application/json", ".json": "application/json" };
const requests = [];
// The streaming session gets its pieces; the tools session, both calls at once, then its last words once results are back.
const provider = standInHandler((body) => {
  if (!J(body?.messages ?? []).includes(TOOL_SESSION)) return { pieces: PIECES, everyMs: 400 };
  if (!(body.messages ?? []).some((m) => m.role === "tool")) return { calls: TOOLS.map((t, i) => ({ id: `call_${i}`, name: t.id, input: {} })) };
  return { pieces: ["Both ", "realms ", "answered."], everyMs: 100 };
}, requests);
const served = [];
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  served.push(pathname);
  if (pathname.startsWith("/provider/")) return provider(req, res);
  const [, first, ...rest] = pathname.split("/");
  if (first.startsWith("automerge:")) {
    const content = scratch.get(first)?.[rest.join("/")];
    if (content === undefined) return void res.writeHead(404).end();
    return void res.writeHead(200, { "content-type": MIME[extname(rest.at(-1))] ?? "application/octet-stream", "cache-control": "no-cache" }).end(content);
  }
  const path = join(root, pathname);
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${PORT}`;

// ── Chrome ──
const profile = mkdtempSync(join(SCRATCH, "session-task-browser-profile-"));
const chrome = spawn(CHROME, [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
let stopped = false;
const stop = (code) => {
  if (stopped) return;
  stopped = true;
  killChrome(chrome);
  server.closeAllConnections?.();
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
setTimeout(() => (console.error("TIMEOUT"), stop(2)), 5 * 60_000).unref();

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
const workerErrors = [];
const workers = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { ok, no, method } = pending.get(m.id);
    pending.delete(m.id);
    return m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
  }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "worker") {
    const { sessionId, targetInfo } = m.params;
    workers.set(sessionId, targetInfo.url);
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
    send("Runtime.enable", {}, sessionId).catch(() => {});
    send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
  }
  if (m.sessionId && workers.has(m.sessionId)) {
    const name = workers.get(m.sessionId).split("/").at(-1);
    if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) workerErrors.push(`${name}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)}`);
    if (m.method === "Runtime.exceptionThrown") workerErrors.push(`${name} exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no, method });
    ws.send(J({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function tab(path, browserContextId) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  await send("Page.navigate", { url: `${base}${path}` }, sessionId);
  const js = async (expr, ms = 60_000) => {
    const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId), sleep(ms).then(() => ({ exceptionDetails: { text: `no answer in ${ms} ms` } }))]);
    if (r.exceptionDetails) throw new Error(`${expr.slice(0, 100)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const waitFor = async (expr, ms = 20_000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) {
      try {
        const v = await js(expr, 5_000);
        if (v) return v;
      } catch {}
    }
    return false;
  };
  if (!(await waitFor("window.ready === true"))) throw new Error("the page did not start");
  return { js, waitFor };
}

try {
  const { browserContextId } = await send("Target.createBrowserContext", {});
  const S = await tab(`/probe/index.html?sync=${encodeURIComponent(SYNC)}`, browserContextId);
  // The Tasks package installed in the page's registry, from its built entry.
  await S.js("(async () => { const { registerPlugins } = await import('@inkandswitch/patchwork-plugins'); registerPlugins((await import('/dist/index.js')).plugins, location.origin + '/dist/index.js'); return true; })()");
  // The scratch package installed as core's page installs one kept in automerge.
  await S.js(`probe.install(${J(PKG)}, ${J(TOOLS)})`);
  await S.js("probe.makeAccount()");
  const joined = await S.js("probe.join()");
  await S.js("probe.mount()");
  const running = await S.waitFor("probe.status()?.state === 'running'", 30_000);
  await sleep(LISTEN_MS);

  // A session as initSession makes it, with one message; made in the page's Repo.
  const session = {};
  initSession(session, {});
  session.config.model = "made-up/model";
  session.turns.push(makeTurn("user", [textBlock("Stream something, please.")]));
  session.burst = null;
  const importUrl = `${base}/agent/runners/session-task.js`;
  const got = await S.js(
    `(async () => {
      const repo = probe.repo;
      const handle = repo.create(${J(session)});
      await repo.flush();
      const replyText = (doc) => {
        const turn = [...(doc.turns ?? [])].reverse().find((t) => t.role === 'assistant');
        return (turn?.blocks ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      };
      const seen = [];
      handle.on('change', ({ doc }) => seen.push({ at: performance.now(), text: replyText(doc) }));
      const input = {
        session: handle.url,
        heads: [...handle.heads()],
        account: { rootFolderUrl: null, sensitiveDocs: [] },
        providerUrl: ${J(`${base}/provider`)},
        keys: { model: ${J(MODEL_KEY)}, search: null, relay: null },
      };
      const t0 = performance.now();
      const ran = await probe.timeRun(${J(importUrl)}, input).catch((error) => ({ error: String(error?.message ?? error) }));
      const heard = performance.now();
      // The ending is heard on this machine at once; the run's last writes
      // come by the sync server: wait for the copy to have them, at most 10 s.
      const settled = (d) => d.burst == null && !(d.turns ?? []).some((t) => t.streaming);
      while (!settled(handle.doc()) && performance.now() - heard < 10_000) await new Promise((r) => setTimeout(r, 50));
      const doc = handle.doc();
      return { ran, ms: heard - t0, lagMs: Math.round(performance.now() - heard), seen: seen.map((s) => ({ ms: Math.round(s.at - t0), length: s.text.length })), text: replyText(doc), burst: doc.burst ?? null, marks: (doc.turns ?? []).filter((t) => t.streaming).length };
    })()`,
    150_000,
  );
  const result = got.ran?.result;
  const asked = requests.filter((r) => /chat\/completions$/.test(r.path));
  check(
    1,
    "the session task runs in the browser's run worker and answers { outcome, heads, own }",
    !!running && !!joined?.served && J(Object.keys(result ?? {}).sort()) === J(["heads", "outcome", "own"]) && result.outcome === "idle" && asked.length === 1 && asked[0].authorization === `Bearer ${MODEL_KEY}`,
    `pool running ${!!running}, joined ${J(joined)}; in ${Math.round(got.ms)} ms: ${J(got.ran)}; ${asked.length} request(s) to the stand-in, with the made-up key: ${asked.every((r) => r.authorization === `Bearer ${MODEL_KEY}`)}`,
  );
  const fromAgent = served.filter((p) => p.startsWith("/agent/"));
  check(
    2,
    "it imports Automerge by bare name in the run worker (host/modules.js), resolved by the page's import map, and reads its task's runs with the task client its registry gives (host/import.js)",
    !!result && fromAgent.includes("/agent/host/modules.js") && fromAgent.includes("/agent/host/import.js") && !fromAgent.some((p) => /task-(client|rules)/.test(p)) && !workerErrors.some((e) => /automerge|resolve|import|tasks-next/i.test(e)),
    `${fromAgent.length} of this package's files served, host/modules.js among them ${fromAgent.includes("/agent/host/modules.js")}, host/import.js ${fromAgent.includes("/agent/host/import.js")}, a task file of its own ${fromAgent.some((p) => /task-(client|rules)/.test(p))} (expected false), node-fetch.mjs among them ${fromAgent.includes("/agent/net/node-fetch.mjs")} (expected false); workers' errors ${workerErrors.length ? J(workerErrors.slice(0, 5)) : "none"}`,
  );
  const lengths = [...new Set(got.seen.map((s) => s.length))].filter((n) => n > 0);
  const sums = PIECES.map((_, k) => PIECES.slice(0, k + 1).join("").length);
  check(
    3,
    "the text streams into the page's copy of the session, piece by piece",
    got.text === PIECES.join("") && lengths.length >= 3 && lengths.every((n) => sums.includes(n)) && got.marks === 0 && got.burst === null,
    `text ${J(got.text)}; lengths the page saw ${J(lengths)} of ${J(sums)}; ${got.lagMs} ms after the ending was heard, marks left ${got.marks} and burst ${J(got.burst)}`,
  );

  // 4 to 6: a session whose model calls both of the scratch package's tools.
  const toolSession = {};
  initSession(toolSession, {});
  toolSession.config.model = "made-up/model";
  toolSession.turns.push(makeTurn("user", [textBlock(TOOL_SESSION)]));
  toolSession.burst = null;
  const tools = await S.js(
    `(async () => {
      const repo = probe.repo;
      const handle = repo.create(${J(toolSession)});
      await repo.flush();
      const input = () => ({
        session: handle.url,
        heads: [...handle.heads()],
        account: { rootFolderUrl: null, sensitiveDocs: [] },
        providerUrl: ${J(`${base}/provider`)},
        keys: { model: ${J(MODEL_KEY)}, search: null, relay: null },
      });
      const blocks = () => (handle.doc().turns ?? []).flatMap((t) => t.blocks ?? []);
      const calls = () => blocks().filter((b) => b.type === "call").map((b) => ({ tool: b.tool, where: b.where, status: b.status, result: String(blocks().find((r) => r.type === "result" && r.callId === b.id)?.output ?? "") || null }));
      const settle = async (done) => {
        const t0 = performance.now();
        while (!done(handle.doc()) && performance.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 50));
      };
      const asked = input();
      const first = await probe.timeRun(${J(importUrl)}, asked).catch((error) => ({ error: String(error?.message ?? error) }));
      await settle((d) => d.burst == null && calls().some((c) => c.result));
      const parked = calls();
      const { pageCalls } = await import("/agent/runners/page.js");
      const { loadPluginTools } = await import("/agent/assembly/plugins.js");
      const { AGENT } = await import("/agent/assembly/agent.js");
      const page = pageCalls(handle, { context: { repo }, builtins: AGENT.builtins, plugins: () => loadPluginTools(), beatMs: 0, target: null });
      await page.tick();
      page.dispose();
      const ranByPage = calls();
      const second = await probe.timeRun(${J(importUrl)}, input()).catch((error) => ({ error: String(error?.message ?? error) }));
      const last = () => (handle.doc().turns.at(-1)?.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      await settle((d) => d.burst == null && last() === "Both realms answered.");
      return { inputFields: Object.keys(asked), first, parked, ranByPage, second, last: last(), burst: handle.doc().burst ?? null };
    })()`,
    150_000,
  );
  const toolAsks = requests.filter((r) => /chat\/completions$/.test(r.path) && J(r.body?.messages ?? []).includes(TOOL_SESSION));
  const offeredTools = (toolAsks[0]?.body?.tools ?? []).map((t) => t.function?.name);
  check(
    4,
    "a burst offers the scratch package's two tools, from its run worker's registry; its input carries nothing of them",
    TOOLS.every((t) => offeredTools.includes(t.id)) && J(tools.inputFields) === J(["session", "heads", "account", "providerUrl", "keys"]),
    `${offeredTools.length} tools offered, the scratch package's ${J(offeredTools.filter((id) => id.startsWith("probe_")))}; the input's fields ${J(tools.inputFields)}`,
  );
  const workerCall = (list) => list?.find((c) => c.tool === "probe_realm_worker");
  const pageCall = (list) => list?.find((c) => c.tool === "probe_realm_page");
  check(
    5,
    "the stand-in calls both: the worker tool runs in the burst, in the pool's run worker, and its result lands in the session",
    workerCall(tools.parked)?.where === "worker" && /^ran in DedicatedWorkerGlobalScope at \/dist\/assets\/run-worker-entry/.test(workerCall(tools.parked)?.result ?? ""),
    `the worker tool's call ${J(workerCall(tools.parked))}`,
  );
  check(
    6,
    "the page tool's call parks; the page runs it (runners/page.js pageCalls, the page's registry), and the next burst carries on",
    tools.first?.result?.outcome === "parked" && pageCall(tools.parked)?.where === "host" && pageCall(tools.parked)?.result === null && /^ran in Window at \/probe\/index\.html/.test(pageCall(tools.ranByPage)?.result ?? "") && tools.second?.result?.outcome === "idle" && tools.last === "Both realms answered." && tools.burst === null && toolAsks.length === 2,
    `the first burst ${J(tools.first?.result?.outcome ?? tools.first)}, the page call then ${J(pageCall(tools.parked))}; after the page ${J(pageCall(tools.ranByPage))}; the second burst ${J(tools.second?.result?.outcome ?? tools.second)}, last words ${J(tools.last)}, burst ${J(tools.burst)}; ${toolAsks.length} model requests for this session`,
  );
  await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
}
if (workerErrors.length) console.error(`what workers said as errors (${workerErrors.length}):\n  ${workerErrors.slice(0, 20).join("\n  ")}`);
stop(failed ? 1 : 0);
