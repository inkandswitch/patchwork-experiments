// A checker's probe: a package's agent tools in a burst asked from a page
// that does NOT hold its browser's pool, with no network. The tasks
// package's stand-in page as probes/session-task-second-tab.mjs serves it
// (`?site` pages, Chrome resolving no host but 127.0.0.1). A scratch package
// (a made-up url at heads, its files served here where the site's service
// worker serves a package kept in automerge) registers two agent tools, one
// declared for a worker and one for a page, each answering with the realm
// and tab that ran it; it is installed in both tabs.
//
//   (in the chrome slot, after `pnpm build` in tasks/) node probes/checked-offline-tools-browser.mjs [--show] [--scratch <dir>]
//
// Checks, one line each:
//   O1 L holds the pool and M waits
//   O2 M asks (runners/ask.js askWork); the worker tool runs in the burst, in
//      L's pool's run worker
//   O3 the page tool's call parks; M runs it (runners/page.js pageCalls, M's
//      registry), asks again, and the next burst carries on to the last words
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
const SCRATCH = arg("--scratch") ?? process.env.PROBE_SCRATCH ?? tmpdir();
const PORT = 47935;
const CDP = 47936;
const LISTEN_MS = 2_500;
const MODEL_KEY = "made-up-model-key-second-tab-7c21";
const PIECES = ["Asked ", "from ", "the ", "other ", "tab, ", "run ", "by ", "the ", "pool."];

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

// ── what is served: the stand-in page as browser-run.mjs lays it out, this package at /agent ──
mkdirSync(SCRATCH, { recursive: true });
const root = mkdtempSync(join(SCRATCH, "session-task-second-tab-"));
const modules = join(TASKS, "node_modules");
const siteModules = resolve(realpathSync(join(modules, "site-automerge-repo")), "../..");
symlinkSync(join(TASKS, "dist"), join(root, "dist"));
symlinkSync(join(TASKS, "probes/browser-run"), join(root, "probe"));
symlinkSync(AGENT, join(root, "agent"));
symlinkSync(join(siteModules, "@automerge/automerge/dist/automerge.wasm"), join(root, "automerge.wasm"));
symlinkSync(join(siteModules, "@automerge/automerge-subduction/dist/automerge-subduction.wasm"), join(root, "subduction.wasm"));
const base = `http://127.0.0.1:${PORT}`;
mkdirSync(join(root, "wrap"));
writeFileSync(
  join(root, "wrap/session-task.js"),
  `import sessionTask from "/agent/runners/session-task.js";\nexport default (input, ctx) => sessionTask({ ...input, providerUrl: ${J(`${base}/provider`)} }, ctx);\n`,
);
const stubs = join(root, "stubs");
mkdirSync(stubs);
const vendor = {
  "automerge-slim": "@automerge/automerge/slim",
  "automerge-repo-slim": "site-automerge-repo/slim",
  "automerge-repo-storage-indexeddb": "site-automerge-repo-storage-indexeddb",
  "automerge-repo-network-messagechannel": "@automerge/automerge-repo-network-messagechannel",
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
    {
      name: "one-repo-for-the-adapter",
      setup(b) {
        b.onResolve({ filter: /^@automerge\/automerge-repo\/slim$/ }, (args) =>
          /automerge-repo-network-messagechannel/.test(args.importer) ? b.resolve("site-automerge-repo/slim", { resolveDir: TASKS, kind: args.kind }) : undefined,
        );
      },
    },
  ],
});


// ── a checker's probe: a scratch package's worker and page tools, asked from the tab that does not hold the pool, with no network ──
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo";
const PKG = stringifyAutomergeUrl({ documentId: parseAutomergeUrl(generateAutomergeUrl()).documentId, heads: encodeHeads(["d".repeat(64)]) });
const TOOLS = [
  { type: "agent:tool", id: "probe_realm_worker", name: "Realm (worker)", description: "Say which realm runs this tool.", where: "worker", risk: "read", input_schema: { type: "object", properties: {} } },
  { type: "agent:tool", id: "probe_realm_page", name: "Realm (page)", description: "Say which realm runs this tool, from a page.", where: "host", risk: "read", input_schema: { type: "object", properties: {} } },
];
const realmCode = `export default { execute: async () => "ran in " + (globalThis.constructor?.name ?? "?") + " at " + (globalThis.location?.pathname ?? "?") + (globalThis.document ? " (" + document.visibilityState + ", tab " + (window.probeTab ?? "?") + ")" : "") };\n`;
const scratch = new Map([[PKG, {
  "package.json": J({ name: "probe-realm-tools", type: "module", main: "index.js" }),
  "index.js": `export const plugins = ${J(TOOLS)}.map((t) => ({ ...t, load: () => import(t.where === "worker" ? "./worker.js" : "./page.js").then((m) => m.default) }));\n`,
  "worker.js": realmCode,
  "page.js": realmCode,
}]]);
const TOOL_SESSION = "Run both realm tools.";
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".map": "application/json", ".json": "application/json" };
const requests = [];
const provider = standInHandler((body) => {
  if (!J(body?.messages ?? []).includes(TOOL_SESSION)) return { pieces: ["Hello."], everyMs: 100 };
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


// ── Chrome, with no network but this machine ──
const profile = mkdtempSync(join(SCRATCH, "session-task-second-tab-profile-"));
const chrome = spawn(
  CHROME,
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", "--mute-audio", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, "about:blank"].filter(Boolean),
  { stdio: "ignore", detached: true },
);
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
const workers = new Map(); // worker session → { url, parent tab session }
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { ok, no, method } = pending.get(m.id);
    pending.delete(m.id);
    return m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result);
  }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "worker") {
    const { sessionId, targetInfo } = m.params;
    workers.set(sessionId, { url: targetInfo.url, parent: m.sessionId ?? null });
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
    send("Runtime.enable", {}, sessionId).catch(() => {});
    send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
  }
  if (m.sessionId && workers.has(m.sessionId)) {
    const name = workers.get(m.sessionId).url.split("/").at(-1);
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
  /** The workers this tab has now, by url (pool and run workers are this tab's own). */
  const liveWorkers = () => [...workers.values()].filter((w) => w.parent === sessionId).map((w) => w.url.split("/").at(-1));
  return { js, waitFor, liveWorkers, sessionId };
}

// In a page: the Tasks package installed in its registry, from its built
// entry; the agent's asker with the client the registry gives it, counting its
// doWork calls.
const ASKER = `(async () => {
  if (window.asker) return true;
  performance.setResourceTimingBufferSize(10000);
  const { registerPlugins } = await import('@inkandswitch/patchwork-plugins');
  registerPlugins((await import('/dist/index.js')).plugins, location.origin + '/dist/index.js');
  const ask = await import('/agent/runners/ask.js');
  const value = await import('/agent/ui/session-value.js');
  const client = await (await import('/agent/host/import.js')).taskClient();
  const calls = [];
  const counted = { ...client, doWork: (...args) => (calls.push(performance.now()), client.doWork(...args)) };
  window.asker = { ask, value, client, calls, counted };
  return true;
})()`;

/** A session as initSession makes it, with one message. */
function newSession() {
  const session = {};
  initSession(session, {});
  session.config.model = "made-up/model";
  session.turns.push(makeTurn("user", [textBlock("Say something from the other tab, please.")]));
  session.burst = null;
  return session;
}


try {
  const { browserContextId } = await send("Target.createBrowserContext", {});
  const path = "/probe/index.html?site";
  const L = await tab(path, browserContextId);
  await L.js("window.probeTab = 'L'");
  await L.js(`probe.install(${J(PKG)}, ${J(TOOLS)})`);
  await L.js("probe.makeAccount()");
  await L.js("probe.mountBackground()");
  const running = await L.waitFor("probe.status()?.state === 'running'", 30_000);
  await sleep(LISTEN_MS);
  const M = await tab(path, browserContextId);
  await M.js("window.probeTab = 'M'");
  await M.js(`probe.install(${J(PKG)}, ${J(TOOLS)})`);
  await M.js("probe.mountBackground()");
  const waiting = await M.waitFor("probe.status()?.state === 'waiting'", 15_000);
  await M.js(ASKER);
  check("O1", "L holds the pool and M waits, with no network", !!running && !!waiting, `L running ${!!running}, M waiting ${!!waiting}`);
  const s = newSession();
  s.turns[0].blocks[0].text = TOOL_SESSION;
  const got = await M.js(
    `(async () => {
      const site = probe.site;
      const handle = site.create(${J(s)});
      await site.flush([handle.documentId]);
      const blocks = () => (handle.doc().turns ?? []).flatMap((t) => t.blocks ?? []);
      const calls = () => blocks().filter((b) => b.type === "call").map((b) => ({ tool: b.tool, where: b.where, status: b.status, result: String(blocks().find((r) => r.type === "result" && r.callId === b.id)?.output ?? "") || null }));
      const last = () => (handle.doc().turns.at(-1)?.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const opts = { client: asker.counted, importUrl: ${J(`${base}/wrap/session-task.js`)}, keys: { model: ${J(MODEL_KEY)}, search: null, relay: null } };
      const first = await asker.ask.askWork(site, handle.url, opts).catch((error) => ({ error: String(error?.message ?? error) }));
      for (const t0 = performance.now(); !(handle.doc().burst == null && calls().some((c) => c.result)) && performance.now() - t0 < 10_000; ) await new Promise((r) => setTimeout(r, 50));
      const parked = calls();
      const { pageCalls } = await import("/agent/runners/page.js");
      const { loadPluginTools } = await import("/agent/assembly/plugins.js");
      const { AGENT } = await import("/agent/assembly/agent.js");
      const page = pageCalls(handle, { context: { repo: site }, builtins: AGENT.builtins, plugins: () => loadPluginTools(), beatMs: 0, target: null });
      await page.tick();
      page.dispose();
      const ranByPage = calls();
      const second = await asker.ask.askWork(site, handle.url, opts).catch((error) => ({ error: String(error?.message ?? error) }));
      for (const t0 = performance.now(); !(handle.doc().burst == null && last() === "Both realms answered.") && performance.now() - t0 < 10_000; ) await new Promise((r) => setTimeout(r, 50));
      return { first, parked, ranByPage, second, last: last(), burst: handle.doc().burst ?? null };
    })()`,
    150_000,
  );
  const w = (list) => list?.find((c) => c.tool === "probe_realm_worker");
  const p = (list) => list?.find((c) => c.tool === "probe_realm_page");
  check("O2", "asked from M with no network: the worker tool runs in the burst, in L's pool's run worker", got.first?.outcome === "parked" && w(got.parked)?.where === "worker" && /^ran in DedicatedWorkerGlobalScope at \/dist\/assets\/run-worker-entry/.test(w(got.parked)?.result ?? ""), `first ${J(got.first)}; worker call ${J(w(got.parked))}`);
  check("O3", "the page tool's call parks, M (not holding the pool) runs it, and M's next ask carries on to the last words", p(got.parked)?.where === "host" && p(got.parked)?.result === null && /^ran in Window at \/probe\/index\.html \(\w+, tab M\)/.test(p(got.ranByPage)?.result ?? "") && got.second?.outcome === "idle" && got.last === "Both realms answered." && got.burst === null, `parked ${J(p(got.parked))}; after M ${J(p(got.ranByPage))}; second ${J(got.second)}; last ${J(got.last)}`);
  await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
}
const offMachine = served.filter((p) => !p.startsWith("/")).length;
if (workerErrors.length) console.error(`what workers said as errors (${workerErrors.length}):\n  ${workerErrors.slice(0, 20).join("\n  ")}`);
console.error(`${served.length} requests served here${offMachine ? `, ${offMachine} odd` : ""}`);
stop(failed ? 1 : 0);
