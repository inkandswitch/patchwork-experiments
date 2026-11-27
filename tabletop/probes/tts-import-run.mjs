// A TTS import as a task, end to end, in Node: a tasks host (TASKS_HOST, by
// default ../tasks/dist-node/host.mjs, built there by `pnpm build:node`)
// serving a new queue and running this directory as a made-up package
// (--local), asked by this process from a Repo of its own through
// ../tasks/dist-node/task-client.mjs, the way the TTS import tool on another
// machine would ask, through the real sync server. The task is the built
// dist/import-task.js (run `pnpm build` first), the path a page asks for; it
// gets the task client from the run thread's plugin registry (tasks-next,
// the host's own build: this package names no tasks package).
//
// The mod is the tiny fixture (fixtures/tiny-mod), kept as file docs as the
// tool keeps a drop (src/tts/dropped.js). Nothing is fetched from the
// internet: for the checks that need an import to be under way, the one
// asset the fixture does not carry is named at a server this probe runs on
// 127.0.0.1, which holds the request open until it is told to answer.
//
//   (in tabletop/) node probes/tts-import-run.mjs [--sync wss://…] [--verbose]
//
// Checks, one line each, with what was seen:
// 1. the fixture imports to a game doc that is the format's own fixture of
//    it (contract/v2's valid/tts-tiny-mod.json), as the importer's tests
//    expect, and the import doc names it;
// 2. asked again under the same key once it has ended, it is another task,
//    which finds the first one's game and makes none;
// 3. asking again under the same key while it runs is the same task;
// 4. a cancel mid-import ends the task cancelled, and leaves no game and no
//    outcome on the import doc;
// 5. a host stopped mid-import and started again finishes the import once:
//    its runs are lost, then succeeded, and the doc names one game.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { fixtureSources } from "../src/tts/test/fixture.js";
import { storeDropped } from "../src/tts/dropped.js";
import { canonicalJson, importAsk, importRequest } from "../src/tts/request.js";
import { DEFAULT_SETTINGS } from "../src/tts/settings.js";
import tinyGame from "../contract/v2/fixtures/valid/tts-tiny-mod.json" with { type: "json" };

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const HOST = resolve(process.env.TASKS_HOST ?? join(PACKAGE_DIR, "../tasks/dist-node/host.mjs"));
const { ask, run } = await import(join(dirname(HOST), "task-client.mjs"));

// a made-up package that this directory stands for, and the built task in it as a browser names it
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKG = `automerge:${Array.from({ length: 28 }, () => BASE58[Math.floor(Math.random() * 58)]).join("")}`;
const IMPORT_URL = `/${encodeURIComponent(PKG)}/dist/import-task.js`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms, what, every = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await test().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`${what}: not after ${ms / 1000} s`);
    await sleep(every);
  }
};
let failed = false;
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : JSON.stringify(saw)}`);
};

// ── the asset server: holds each request until told to answer ──
const OBJ = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const asset = { held: [], answering: false, asked: 0 };
const server = createServer((req, res) => {
  asset.asked++;
  if (asset.answering) return res.end(OBJ);
  asset.held.push(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const SLOW_URL = `http://127.0.0.1:${server.address().port}/slow-model.obj`;

// ── the host ──
const dataDir = mkdtempSync(join(tmpdir(), "tts-import-task-"));
let host = null;
function startHost(args) {
  const h = { lines: [], queue: null, pool: null, exit: null };
  h.child = spawn(process.execPath, [HOST, ...args, "--local", `${PKG}=${PACKAGE_DIR}`, "--data-dir", dataDir, "--workers", "2", "--name", "tts-probe", "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
  h.child.on("exit", (code, signal) => (h.exit = { code, signal }));
  for (const stream of [h.child.stdout, h.child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        h.lines.push(text);
        h.queue ??= /made the queue "[^"]*": (automerge:\S+)/.exec(text)?.[1] ?? null;
        h.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[host] ${text}\n`);
      }
    });
  }
  return h;
}
async function stopHost(h, signal = "SIGTERM") {
  if (!h || h.exit) return;
  h.child.kill(signal);
  await Promise.race([new Promise((r) => h.child.on("exit", r)), sleep(15000)]);
  if (!h.exit) h.child.kill("SIGKILL");
}
process.on("exit", () => {
  if (host && !host.exit) host.child.kill("SIGKILL");
  rmSync(dataDir, { recursive: true, force: true });
});

// The game as text with every name a repo or a hash gave it replaced by the
// order it is first met in a walk that does not depend on key order: from
// the setup (a list), then everything in sorted key order. A game read back
// from automerge has its keys sorted, so the importer tests' renaming (by
// the order the pieces were written) does not carry over.
function canonicalGame(g) {
  const names = new Map();
  const walk = (v) => {
    if (typeof v === "string") {
      if (names.has(v)) return;
      if (g.pieces[v]) {
        names.set(v, `kind${names.size}`);
        walk(g.pieces[v]);
      } else if (v.startsWith("automerge:")) names.set(v, `automerge:${names.size}`);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const k of Object.keys(v).sort()) (walk(k), walk(v[k]));
  };
  walk(g.setup);
  walk(g);
  const rename = (v) => (typeof v === "string" ? (names.get(v) ?? v) : Array.isArray(v) ? v.map(rename) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [names.get(k) ?? k, rename(x)])) : v);
  return canonicalJson(rename(JSON.parse(JSON.stringify(g))));
}

let exitCode = 1;
try {
  host = startHost(["--new-queue", "tts import probe"]);
  await until(async () => host.queue && host.pool, 60000, "the host making its queue and saying who it is");
  if (host.exit) throw new Error(`the host ended: ${JSON.stringify(host.exit)}`);
  const Q = host.queue;
  console.error(`  host: pool ${host.pool}, queue ${Q}, package ${PKG} = ${PACKAGE_DIR}`);

  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });

  /** An import doc asking for the fixture, kept as a drop keeps it; `slow`: its one web asset at the held server, fetched now. */
  async function importDoc(title, { slow = false } = {}) {
    const sources = fixtureSources().map((s) =>
      slow && s.path.endsWith(".json") ? { ...s, read: async () => new TextEncoder().encode(new TextDecoder().decode(await s.read()).replaceAll("https://example.invalid/missing-model.obj", SLOW_URL)) } : s,
    );
    const files = await storeDropped(repo, sources);
    const request = await importRequest(files, { ...DEFAULT_SETTINGS, fetchNow: slow });
    const handle = repo.create({ "@patchwork": { type: "tts-import" }, title, settings: { ...DEFAULT_SETTINGS }, request, imported: null, games: [] });
    await repo.flush();
    return { handle, ...importAsk(handle.url, request) };
  }
  const ask1 = (input, key) => ({ importUrl: IMPORT_URL, input, key });
  const runsOf = async (taskUrl) => (await repo.find(taskUrl)).doc().runs.map((r) => ({ status: r.status ?? "open", by: r.pool ? (r.pool === host.pool ? "this host" : "a pool") : "the asker", last: r.logs?.at(-1)?.message }));

  // 1: the fixture, as it is
  {
    const { handle, input, key } = await importDoc("Probe 1");
    const views = [];
    const t0 = Date.now();
    let result = null;
    let error = null;
    try {
      result = await Promise.race([run(repo, Q, ask1(input, key), (v) => views.push({ state: v.state, taskUrl: v.taskUrl, progress: v.progress })), sleep(180000).then(() => Promise.reject(new Error("no answer in 180 s")))]);
    } catch (err) {
      error = String(err?.message ?? err);
    }
    const ms = Date.now() - t0;
    let game = null;
    let same = false;
    if (result?.imported) {
      const d = await until(async () => (handle.doc()?.imported?.gameUrl === result.gameUrl ? handle.doc() : null), 30000, "the import doc naming the game");
      const g = await until(async () => {
        const doc = (await repo.find(result.gameUrl)).doc();
        return doc?.pieces ? doc : null;
      }, 30000, "the game arriving");
      const { "@patchwork": type, drawn: _d, tables: _t, ...rest } = g;
      same = canonicalGame(rest) === canonicalGame(tinyGame);
      game = { type: type?.type, pieces: Object.keys(g.pieces).length, setup: g.setup.length, sameAsTheFormatsFixture: same, assets: d.imported.report.counts.assets, games: d.games.length };
    }
    check(1, "the fixture imports to the game the importer's tests expect, named by the import doc", !!result?.imported && same && game?.games === 1, { ms, error, result: result && { ...result, bytes: JSON.stringify(result).length }, game, stages: [...new Set(views.map((v) => v.progress?.phase).filter(Boolean))] });

    // 2: asked again under the key once it has ended: another task, the same game
    const firstTask = views.findLast((v) => v.taskUrl)?.taskUrl;
    const againViews = [];
    const again = await Promise.race([run(repo, Q, ask1(input, key), (v) => againViews.push(v.taskUrl)), sleep(120000).then(() => null)]).catch((err) => ({ error: String(err?.message ?? err) }));
    const againTask = againViews.findLast(Boolean);
    await sleep(2000);
    check(2, "asked again once it has ended, it is another task, which returns the first game and makes none", again?.gameUrl === result?.gameUrl && !!againTask && againTask !== firstTask && handle.doc().games.length === 1, { again, firstTask, againTask, games: handle.doc().games.length });
  }

  // 3 and 4: an import under way, asked again, then cancelled
  {
    const { handle, input, key } = await importDoc("Probe 3", { slow: true });
    const controller = new AbortController();
    const views = [];
    const t0 = Date.now();
    const asked = run(repo, Q, ask1(input, key), (v) => views.push({ at: Date.now() - t0, state: v.state, taskUrl: v.taskUrl, phase: v.progress?.phase }), controller.signal).then(
      () => "resolved",
      (err) => String(err?.message ?? err),
    );
    await until(async () => asset.held.length > 0, 120000, "the import fetching the held asset");
    const first = views.findLast((v) => v.taskUrl)?.taskUrl;
    const again = await ask(repo, Q, ask1(input, key));
    check(3, "asking again under the same key while it runs is the same task", again.taskUrl === first && views.at(-1).state === "running", { first, again: again.taskUrl, state: views.at(-1).state, phase: views.at(-1).phase });
    const abortedAt = Date.now() - t0;
    controller.abort();
    const outcome = await Promise.race([asked, sleep(60000).then(() => "no answer in 60 s")]);
    const endedAt = Date.now() - t0;
    await sleep(5000);
    const runs = first ? await runsOf(first) : null;
    check(4, "a cancel mid-import ends the task cancelled and leaves no game and no outcome", outcome === "The task was cancelled" && handle.doc().imported === null && handle.doc().games.length === 0 && runs?.some((r) => r.status === "cancelled" && r.by !== "the asker"), { abortedAt, endedAt, outcome, imported: handle.doc().imported, games: handle.doc().games.length, runs });
    for (const res of asset.held.splice(0)) res.destroy();
  }

  // 5: the host stopped mid-import, and started again
  {
    const { handle, input, key } = await importDoc("Probe 5", { slow: true });
    const views = [];
    const asked = run(repo, Q, ask1(input, key), (v) => views.push({ state: v.state, taskUrl: v.taskUrl })).then(
      (r) => r,
      (err) => ({ error: String(err?.message ?? err) }),
    );
    const before = asset.asked;
    await until(async () => asset.held.length > 0 && asset.asked > before, 120000, "the import fetching the held asset");
    const taskUrl = views.findLast((v) => v.taskUrl)?.taskUrl;
    const firstPool = host.pool;
    await stopHost(host);
    const stopped = host.exit;
    for (const res of asset.held.splice(0)) res.destroy();
    asset.answering = true;
    host = startHost(["--queue", Q]);
    await until(async () => host.pool, 60000, "the host started again");
    const result = await Promise.race([asked, sleep(180000).then(() => ({ error: "no answer in 180 s" }))]);
    await until(async () => (handle.doc()?.imported?.gameUrl ? true : null), 30000, "the import doc naming the game").catch(() => null);
    const runs = taskUrl ? await runsOf(taskUrl) : null;
    const d = handle.doc();
    check(
      5,
      "a host stopped mid-import and started again finishes it once: lost, then succeeded, one game",
      result?.imported === true && runs?.map((r) => r.status).join(",") === "lost,succeeded" && d.games.length === 1 && d.imported?.gameUrl === result.gameUrl && d.imported.report.counts.assets.fetched === 1,
      { stopped, samePool: host.pool === firstPool, result, runs, games: d.games.length, fetched: d.imported?.report?.counts?.assets?.fetched },
    );
  }

  exitCode = failed ? 1 : 0;
} catch (err) {
  console.error(`FAIL the probe stopped: ${err?.stack ?? err}`);
  console.error(host?.lines.slice(-40).join("\n"));
} finally {
  await stopHost(host);
  if (failed && !VERBOSE) console.error(`the host's last lines:\n${host?.lines.slice(-30).join("\n")}`);
  server.close();
  process.exit(exitCode);
}
