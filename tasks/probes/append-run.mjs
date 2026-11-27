// Text streamed into a document by a task on a Node host, through the real
// sync server: probes/append-task.js appends pieces to a document's `text`
// with Automerge's `splice`, which it imports by bare name and the host
// resolves to its own copy (src/node/task-imports.ts).
//
//   (in tasks/, after `pnpm build:node`) node probes/append-run.mjs [--sync wss://…] [--verbose]
//
// One host (dist-node/host.mjs, a real process with a fresh data directory)
// serves a new queue, with this directory as its copy of
// a made-up package (--local). This process asks it from a Repo of its own
// through dist-node/task-client.mjs, the way a tool on another machine
// would, twice: the task named as a file of that package, then the same
// file's text as a data: URL. Each time the asker makes a document with an
// empty text, asks, and keeps every text its own Repo sees while the task
// runs; then it reads the document's history (probes/append-check.js, which
// the browser's check reads with too).
//
// Each check prints one line with what was observed; the process exits 1 if
// any failed.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo-node";
import { Automerge } from "@automerge/automerge-repo-node/slim";
import { appendedHow, appendedWell } from "./append-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKG = `automerge:${Array.from({ length: 28 }, () => BASE58[Math.floor(Math.random() * 58)]).join("")}`;
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const { run } = await import(join(ROOT, "dist-node/task-client.mjs"));

const FILE = `/${encodeURIComponent(PKG)}/probes/append-task.js`;
const DATA = "data:text/javascript," + encodeURIComponent(readFileSync(join(HERE, "append-task.js"), "utf8"));
const PIECES = ["Once ", "upon ", "a ", "time, ", "the ", "text ", "grew ", "by ", "appends."];
const EVERY_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
const J = JSON.stringify;
let failed = false;
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : J(saw)}`);
};

const dataDir = mkdtempSync(join(tmpdir(), "tasks-append-run-"));
let child = null;
const cleanup = () => {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  rmSync(dataDir, { recursive: true, force: true });
};
process.on("exit", cleanup);
setTimeout(() => (console.error("TIMEOUT"), process.exit(2)), 4 * 60_000).unref();

try {
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const queue = repo.create({ "@patchwork": { type: "task-queue-next" }, title: "append probe queue", jobs: {} });
  await repo.flush();

  const lines = [];
  let pool = null;
  child = spawn(
    process.execPath,
    [join(ROOT, "dist-node/host.mjs"), "--queue", queue.url, "--local", `${PKG}=${ROOT}`, "--data-dir", dataDir, "--workers", "1", "--name", "append-probe", "--sync", SYNC, "--verbose"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        lines.push(text);
        pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[host] ${text}\n`);
      }
    });
  }
  for (let t0 = Date.now(); !pool; await sleep(100)) {
    if (Date.now() - t0 > 30_000 || child.exitCode !== null) throw new Error(`the host did not say who it is: ${J(lines.slice(-5))}`);
  }

  for (const [n, how, importUrl] of [
    [1, "named as a file of a package installed here (--local)", FILE],
    [2, "as a data: URL", DATA],
  ]) {
    const doc = repo.create({ text: "" });
    await repo.flush();
    const seen = [];
    let firstAt = null;
    doc.on("change", ({ doc: now }) => {
      seen.push(now.text);
      firstAt ??= now.text.length > 0 ? Date.now() : null;
    });
    const t0 = Date.now();
    let result;
    try {
      result = await within(90_000, run(repo, queue.url, { importUrl, input: { doc: doc.url, pieces: PIECES, everyMs: EVERY_MS } }), "the task");
    } catch (error) {
      result = { error: String(error?.message ?? error) };
    }
    const ms = Date.now() - t0;
    // what a run wrote can be found once its ending is read: this is what the asker has then
    const atEnd = doc.doc().text;
    const read = appendedHow(doc.doc(), PIECES, seen, Automerge);
    check(
      n,
      `a task on a Node host, ${how}, appends each piece to the end of the text, and the asker sees it grow`,
      result === PIECES.length && atEnd === PIECES.join("") && appendedWell(read, PIECES),
      `returned ${J(result)} in ${ms} ms, the first piece seen after ${firstAt === null ? "never" : `${firstAt - t0} ms`}; text when the ending was read ${J(atEnd)}; the task's changes ${read.changes} for ${PIECES.length} pieces, ${read.endAppends} of them appends at the end${read.notAppend ? `, first not: ${J(read.notAppend)}` : ""}; every text seen a run of whole pieces from the start: ${read.prefixes}; lengths seen on the way ${J(read.between)} of ${J(PIECES.map((_, k) => PIECES.slice(0, k + 1).join("").length).slice(0, -1))}`,
    );
  }
  const problems = lines.filter((l) => /error|crash|threw/i.test(l));
  check(3, "the host said nothing went wrong", problems.length === 0, problems.length ? J(problems.slice(0, 5)) : "nothing");
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
}
if (child && child.exitCode === null) {
  child.kill("SIGTERM");
  for (let t0 = Date.now(); child.exitCode === null && Date.now() - t0 < 10_000; ) await sleep(100);
}
process.exit(failed ? 1 : 0);
