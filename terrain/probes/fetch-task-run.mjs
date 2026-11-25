// Fetch data as a task, end to end, in Node: a tasks host (TASKS_HOST, by
// default ../tasks/dist-node/host.mjs, built there by `pnpm build:node`)
// serving a new queue and running this directory as a made-up package
// (--local), asked by this process from a Repo of its own through
// ../tasks/dist-node/task-client.mjs, the way a Terrain tool on another
// machine would ask, through the real sync server and the real data sources
// (NOAA NCEI and Overpass, for a 65 × 65 grid 8 m apart off Cadboro Bay).
//
//   (in terrain/) node probes/fetch-task-run.mjs [--sync wss://…] [--verbose]
//
// Checks, one line each, with what was seen:
// 1. the fetch succeeds, and the Terrain doc ends up pointing at file docs
//    whose bytes match their recorded SHA-256 (read back from this Repo);
// 2. asking again under the same key while it runs is the same task;
// 3. a cancel mid-fetch ends the task cancelled, and leaves that Terrain doc
//    without data;
// 4. a different frame is a different key, and asking under it is another task.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { cadboroDoc } from "../src/cadboro.js";
import { fetchSpec, fetchKey } from "../src/fetch-spec.js";
import { STAGES } from "../src/fetch-task.js";
import { readTerrainData, dataFits } from "../src/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const HOST = resolve(process.env.TASKS_HOST ?? join(PACKAGE_DIR, "../tasks/dist-node/host.mjs"));
const { ask, cancel, run } = await import(join(dirname(HOST), "task-client.mjs"));

// a made-up package that this directory stands for, and the task's file in it as a browser names it
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKG = `automerge:${Array.from({ length: 28 }, () => BASE58[Math.floor(Math.random() * 58)]).join("")}`;
const IMPORT_URL = `/${encodeURIComponent(PKG)}/src/fetch-task.js`;

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

// ── the host ──
const dataDir = mkdtempSync(join(tmpdir(), "terrain-fetch-task-"));
const host = { lines: [], queue: null, pool: null, exit: null };
const child = spawn(process.execPath, [HOST, "--new-queue", "terrain fetch probe", "--local", `${PKG}=${PACKAGE_DIR}`, "--data-dir", dataDir, "--workers", "2", "--name", "terrain-probe", "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
child.on("exit", (code, signal) => (host.exit = { code, signal }));
for (const stream of [child.stdout, child.stderr]) {
  let rest = "";
  stream.on("data", (chunk) => {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop();
    for (const text of parts) {
      host.lines.push(text);
      host.queue ??= /made the queue "[^"]*": (automerge:\S+)/.exec(text)?.[1] ?? null;
      host.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
      if (VERBOSE) process.stderr.write(`[host] ${text}\n`);
    }
  });
}
const cleanup = () => {
  if (host.exit === null) child.kill("SIGKILL");
  rmSync(dataDir, { recursive: true, force: true });
};
process.on("exit", cleanup);

/** A small Terrain doc off the yacht club, moved `east` metres: a 65 × 65 grid 8 m apart, OSM pinned, no buildings. */
function smallTerrain(east = 0) {
  const d = cadboroDoc();
  delete d.look;
  return { "@patchwork": { type: "terrain" }, ...d, title: `Probe ${east}`, grid: { n: 65, cell: 8, x0: -256 + east, z0: -256 }, data: null, sources: [], attribution: "" };
}

let exitCode = 1;
try {
  await until(async () => host.queue && host.pool, 60000, "the host making its queue and saying who it is");
  if (host.exit) throw new Error(`the host ended: ${JSON.stringify(host.exit)}`);
  const Q = host.queue;
  console.error(`  host: pool ${host.pool}, queue ${Q}, package ${PKG} = ${PACKAGE_DIR}`);

  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const terrain = repo.create(smallTerrain());
  const other = repo.create(smallTerrain(64));
  await repo.flush();
  const key = await fetchKey(terrain.url, fetchSpec(terrain.doc()));

  // 1 and 2: the fetch, asked twice under its key while it runs
  const views = [];
  const t0 = Date.now();
  const running = run(repo, Q, { importUrl: IMPORT_URL, input: { terrain: terrain.url }, key }, (v) => views.push({ at: Date.now() - t0, state: v.state, progress: v.progress, taskUrl: v.taskUrl, line: v.logs.at(-1)?.message }));
  const first = await until(async () => views.find((v) => v.state === "running")?.taskUrl, 60000, "the fetch running");
  const again = await ask(repo, Q, { importUrl: IMPORT_URL, input: { terrain: terrain.url }, key });
  const stillRunning = views.at(-1).state === "running";
  check(2, "asking again under the same key while it runs is the same task", again.taskUrl === first && stillRunning, { first, again: again.taskUrl, stillRunning });
  let result = null;
  let error = null;
  try {
    result = await Promise.race([running, sleep(240000).then(() => Promise.reject(new Error("no answer in 240 s")))]);
  } catch (err) {
    error = String(err?.message ?? err);
  }
  const ms = Date.now() - t0;
  let readBack = null;
  if (result?.stored) {
    // the doc as this Repo has it, once it names what the task stored; then its files, checked against their SHA-256
    const d = await until(async () => (terrain.doc()?.data?.dem?.url === result.dem ? terrain.doc() : null), 30000, "the doc naming the stored files");
    readBack = await until(async () => readTerrainData(repo, d), 30000, "the files read back and checked").then(
      (got) => ({ demNodes: got.dem.length, coastWays: got.features.coast.length, fits: dataFits(d), demSha: d.data.dem.sha256.slice(0, 12), featuresSha: d.data.features.sha256.slice(0, 12) }),
      (err) => ({ error: String(err?.message ?? err) }),
    );
  }
  check(1, "the fetch succeeds and the Terrain doc points at file docs whose bytes match their recorded SHA-256", result?.stored === true && readBack?.demNodes === 65 * 65 && readBack.fits, { ms, error, result: result && { stored: result.stored, message: result.message, bytes: JSON.stringify(result).length }, readBack, stages: [...new Set(views.map((v) => v.progress).filter(Boolean))] });

  // 3: a cancel mid-fetch
  const controller = new AbortController();
  const otherKey = await fetchKey(other.url, fetchSpec(other.doc()));
  const otherViews = [];
  const t1 = Date.now();
  const cancelled = run(repo, Q, { importUrl: IMPORT_URL, input: { terrain: other.url }, key: otherKey }, (v) => otherViews.push({ at: Date.now() - t1, state: v.state, progress: v.progress, taskUrl: v.taskUrl }), controller.signal).then(
    () => "resolved",
    (err) => String(err?.message ?? err),
  );
  await until(async () => otherViews.some((v) => v.state === "running" && v.progress === STAGES.fetching), 60000, "the second fetch fetching");
  const abortedAt = Date.now() - t1;
  controller.abort();
  const outcome = await Promise.race([cancelled, sleep(60000).then(() => "no answer in 60 s")]);
  const endedAt = Date.now() - t1;
  // what the task's run said, and whether the doc gained data, a while after
  await sleep(5000);
  const otherTask = otherViews.findLast((v) => v.taskUrl)?.taskUrl;
  const runs = otherTask ? (await repo.find(otherTask)).doc().runs.map((r) => ({ status: r.status ?? "open", pool: r.pool ? "a pool" : "the asker", last: r.logs?.at(-1)?.message })) : null;
  check(3, "a cancel mid-fetch ends the task cancelled and leaves that Terrain doc without data", outcome === "The task was cancelled" && other.doc().data === null && runs?.some((r) => r.status === "cancelled" && r.pool === "a pool"), { abortedAt, endedAt, outcome, data: other.doc().data, runs, lastState: otherViews.at(-1)?.state });

  // 4: a different frame is a different key, and another task
  terrain.change((d) => (d.grid.x0 += 8));
  const movedKey = await fetchKey(terrain.url, fetchSpec(terrain.doc()));
  const moved = await ask(repo, Q, { importUrl: IMPORT_URL, input: { terrain: terrain.url }, key: movedKey });
  await cancel(repo, Q, movedKey);
  check(4, "a different frame is a different key, and asking under it is another task", movedKey !== key && moved.taskUrl !== first, { key: key.slice(-12), movedKey: movedKey.slice(-12), first, moved: moved.taskUrl });

  exitCode = failed ? 1 : 0;
} catch (err) {
  console.error(`FAIL the probe stopped: ${err?.stack ?? err}`);
  console.error(host.lines.slice(-40).join("\n"));
} finally {
  if (host.exit === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((r) => child.on("exit", r)), sleep(10000)]);
  }
  if (failed && !VERBOSE) console.error(`the host's last lines:\n${host.lines.slice(-30).join("\n")}`);
  process.exit(exitCode);
}
