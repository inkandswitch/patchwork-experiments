// A session's work asked from a page that does NOT hold its browser's pool,
// with no network: the agent's own asker (runners/ask.js askWork, with the
// task client the page's registry gives, host/import.js, the Tasks package
// registered there from its built entry) in a second tab of the profile, the
// pool held by the first. The tasks package's stand-in page as
// probes/session-task-browser.mjs serves it, with `?site` pages (a site Repo
// of each tab's own, the two joined only by one database and one heads
// channel, as the site's tabs are) and no sync server: Chrome resolves no
// host but 127.0.0.1, and the pages name an unreachable one.
//
//   (in the chrome slot, after `pnpm build` in tasks/) node probes/session-task-second-tab.mjs [--show] [--scratch <dir>]
//
// The session task is asked through a module served at /wrap that hands the
// task `providerUrl` (the stand-in provider at /provider), as the browser
// probe's input does; askWork's input has no such field.
//
// Checks, one line each:
//   1 L holds the pool, M takes part but waits, and M's poolHere() is true
//   2 M's askWork asks own (the task under agent:<session> is on M's own
//     queue), L's pool runs it in a run worker, and askWork resolves with
//     the burst's outcome; M's document fetched no task code; one doWork
//   3 the streamed text is in M's copy of the session, burst cleared, and
//     nothing is asked again in the 6 s after (no loop)
//   4 a page with no account open: the ask fails, is said in words without
//     urls, is not asked again by itself, and is asked once more (only) when
//     the network comes back
//   5 a page whose pool host arrives late: poolHere() false and the line says
//     this browser is not taking work; when the host registers,
//     hostsChanged (made with ??=, as the agent's view makes it) fires,
//     poolHere() is true, and the line is the plain waiting one
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
// The stand-in page's own client, as browser-run.mjs builds it.
entryPoints["task-client"] = join(TASKS, "src/task-client.js");
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

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".map": "application/json" };
const requests = [];
const provider = standInHandler(() => ({ pieces: PIECES, everyMs: 300 }), requests);
const served = [];
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  served.push(pathname);
  if (pathname.startsWith("/provider/")) return provider(req, res);
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
  // ── 1 to 3: two tabs of one profile, L holds the pool, M asks ──
  {
    const { browserContextId } = await send("Target.createBrowserContext", {});
    const path = "/probe/index.html?site";
    const L = await tab(path, browserContextId);
    await L.js("probe.makeAccount()");
    await L.js("probe.mountBackground()");
    const running = await L.waitFor("probe.status()?.state === 'running'", 30_000);
    await sleep(LISTEN_MS);
    const poolId = await L.js("localStorage.getItem('patchwork-tasks-pool-id')");
    const M = await tab(path, browserContextId);
    await M.js("probe.mountBackground()");
    const waiting = await M.waitFor("probe.status()?.state === 'waiting'", 15_000);
    await M.js(ASKER);
    const mPoolHere = await M.js("asker.client.poolHere()");
    check(
      1,
      "L holds the pool; M takes part but waits; M's poolHere() is true",
      !!running && !!waiting && !!poolId && mPoolHere === true,
      `L running ${!!running}, M waiting ${!!waiting}, pool id ${poolId ? "kept" : "none"}, M's poolHere() ${mPoolHere}; M's workers ${J(M.liveWorkers())}`,
    );

    const importUrl = `${base}/wrap/session-task.js`;
    const got = await M.js(
      `(async () => {
        const site = probe.site;
        const handle = site.create(${J(newSession())});
        await site.flush([handle.documentId]);
        const replyText = (doc) => {
          const turn = [...(doc.turns ?? [])].reverse().find((t) => t.role === 'assistant');
          return (turn?.blocks ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        };
        const views = [];
        const unfollow = asker.ask.followWork(site, handle.url, (view, failed) => views.push({ state: view?.state ?? null, runs: (view?.runs ?? []).map((r) => r?.pool ?? null), failed }), { client: asker.counted });
        const t0 = performance.now();
        const asked = await asker.ask.askWork(site, handle.url, { client: asker.counted, importUrl: ${J(importUrl)}, keys: { model: ${J(MODEL_KEY)}, search: null, relay: null } })
          .catch((error) => ({ error: String(error?.message ?? error) }));
        const ms = performance.now() - t0;
        const settled = (d) => d.burst == null && !(d.turns ?? []).some((t) => t.streaming) && replyText(d).length > 0;
        while (!settled(handle.doc()) && performance.now() - t0 < ms + 10_000) await new Promise((r) => setTimeout(r, 50));
        const own = await asker.client.ownQueue(site);
        const ownDoc = (await site.find(own)).doc();
        const key = 'agent:' + handle.url;
        const fetched = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname);
        window.secondTab = { handle, unfollow, views };
        return {
          asked, ms, text: replyText(handle.doc()), burst: handle.doc().burst ?? null,
          onOwn: JSON.stringify(ownDoc).includes(key),
          views: views.slice(),
          calls: asker.calls.length,
          taskCode: fetched.filter((p) => /session-task|\\/wrap\\//.test(p)),
          askerLoaded: fetched.includes('/agent/runners/ask.js'),
          failed: asker.ask.failedAskOf(handle.url),
        };
      })()`,
      150_000,
    );
    const ranBy = [...new Set(got.views.flatMap((v) => v.runs))];
    const chat = requests.filter((r) => /chat\/completions$/.test(r.path));
    check(
      2,
      "M's askWork asks own and L's pool runs it, with no network: the task under agent:<session> is on M's own queue, its run is the browser's pool's, askWork resolves with the burst's outcome; M fetched no task code; one doWork",
      got.asked?.asked === true && got.asked?.outcome === "idle" && got.onOwn && ranBy.length === 1 && ranBy[0] === poolId && got.taskCode.length === 0 && got.askerLoaded && got.calls === 1 && chat.length === 1 && chat[0].authorization === `Bearer ${MODEL_KEY}` && !M.liveWorkers().some((w) => /run-worker|pool-worker/.test(w)),
      `askWork ${J(got.asked)} in ${Math.round(got.ms)} ms; on own ${got.onOwn}; states ${J([...new Set(got.views.map((v) => v.state))])}, runs by ${J(ranBy.map((p) => (p === poolId ? "this browser's pool" : p)))}; task code M's document fetched ${J(got.taskCode)}; doWork calls ${got.calls}; requests to the stand-in ${chat.length}, with the made-up key ${chat.every((r) => r.authorization === `Bearer ${MODEL_KEY}`)}; M's workers ${J(M.liveWorkers())}, L's ${J(L.liveWorkers())}`,
    );
    await sleep(6_000);
    const after = await M.js("({ calls: asker.calls.length, failed: asker.ask.failedAskOf(secondTab.handle.url), last: secondTab.views.at(-1) })");
    check(
      3,
      "the streamed text is in M's copy, the burst cleared, and nothing is asked again in the 6 s after",
      got.text === PIECES.join("") && got.burst === null && after.calls === 1 && after.failed === null && requests.filter((r) => /chat\/completions$/.test(r.path)).length === 1,
      `text ${J(got.text)}; burst ${J(got.burst)}; doWork calls after 6 s ${after.calls}; failed ${J(after.failed)}; last view ${J(after.last?.state)}`,
    );
    await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }

  // ── 4 and 5: a page of a fresh profile with no account, whose pool host arrives late ──
  {
    const { browserContextId } = await send("Target.createBrowserContext", {});
    const N = await tab("/probe/index.html?site", browserContextId);
    await N.js(ASKER);
    const got = await N.js(
      `(async () => {
        const site = probe.site;
        const handle = site.create(${J(newSession())});
        await site.flush([handle.documentId]);
        window.failing = { handle };
        const asked = await asker.ask.askWork(site, handle.url, { client: asker.counted, importUrl: '/wrap/session-task.js', keys: { model: ${J(MODEL_KEY)}, search: null, relay: null } })
          .then((r) => ({ resolved: r }), (error) => ({ rejected: String(error?.message ?? error) }));
        return { asked, failed: asker.ask.failedAskOf(handle.url), calls: asker.calls.length, account: !!window.accountDocHandle };
      })()`,
      90_000,
    );
    await sleep(6_000);
    const quiet = await N.js("asker.calls.length");
    await N.js("window.dispatchEvent(new Event('online')), true");
    await N.waitFor("asker.calls.length >= 2", 5_000);
    await sleep(5_000);
    const back = await N.js("({ calls: asker.calls.length, failed: asker.ask.failedAskOf(failing.handle.url) })");
    check(
      4,
      "with no account open the ask fails, is said in words without urls, is not asked again by itself, and is asked once more when the network comes back",
      !!got.asked.rejected && typeof got.failed === "string" && got.failed.length > 0 && !/automerge:|:\/\//.test(got.failed) && got.calls === 1 && quiet === 1 && back.calls === 2 && typeof back.failed === "string",
      `account open ${got.account}; askWork ${J(got.asked)}; said ${J(got.failed)}; doWork calls: ${got.calls}, then ${quiet} after 6 s, then ${back.calls} after 'online' and 5 s; said after ${J(back.failed)}`,
    );

    const late = await N.js(
      `(async () => {
        const facts = (here) => asker.value.hintOf(asker.value.hintFacts(failing.handle.doc(), { hasKey: true, work: { state: 'waiting', runs: [] }, pool: null, poolHere: here }));
        const before = { here: asker.client.poolHere(), line: facts(asker.client.poolHere()) };
        let heard = 0;
        const tasks = (globalThis.patchworkTasks ??= {});
        const changed = (tasks.hostsChanged ??= new EventTarget());
        const listen = () => heard++;
        changed.addEventListener('change', listen);
        await probe.mountBackground();
        const after = { here: asker.client.poolHere(), line: facts(asker.client.poolHere()), heard };
        changed.removeEventListener('change', listen);
        return { before, after };
      })()`,
      60_000,
    );
    check(
      5,
      "a pool host arriving late: before it, poolHere() false and the line says this browser is not taking work; it fires hostsChanged on the object the view makes with ??=, and then poolHere() is true and the line is the plain waiting one",
      late.before.here === false && /not taking work/.test(late.before.line) && late.after.heard >= 1 && late.after.here === true && late.after.line === "Waiting for a device to take it",
      J(late),
    );
    await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
}
const offMachine = served.filter((p) => !p.startsWith("/")).length;
if (workerErrors.length) console.error(`what workers said as errors (${workerErrors.length}):\n  ${workerErrors.slice(0, 20).join("\n  ")}`);
console.error(`${served.length} requests served here${offMachine ? `, ${offMachine} odd` : ""}`);
stop(failed ? 1 : 0);
