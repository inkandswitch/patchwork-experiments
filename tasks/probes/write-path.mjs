// How a document travels between a task and whoever asked for it, on Node
// hosts through the real sync server. A run thread's Repo is piped to the
// host's Repo, which has the storage and the socket, so what a task writes
// through ctx.repo reaches the asker by way of the host and the sync server,
// and so does what the asker made for the task to read. This measures that path per size; it checks nothing and
// fails nothing, it says what it saw.
//
//   (in tasks/, after `pnpm build:node`)
//   node probes/write-path.mjs [--only out,in,many,ack,term] [--runs N] [--sizes 10k,1m,…]
//                              [--sync wss://…] [--verbose]
//
// out   the task makes a document of S random bytes and returns its url; the
//       asker, which has never seen it, finds it from the moment it reads
//       the task succeeded, asking again whenever a find rejects. The run
//       worker's document reaches the host's Repo through the pipe and goes on
//       to the sync server from there, so "ask" includes that, and a rejected
//       first find is a broken promise.
// in    the asker makes the document and at once asks a task to read it;
//       the task finds it the same way and says how long it took.
// many  the task writes 20 documents of 250 KB; the asker finds them all.
// ack   out, with the task itself also waiting until the sync server says
//       it holds what was written before it returns (probes/write-path/task.js).
// term  out at 5 MB from a host of its own that is sent SIGTERM the moment
//       the asker reads succeeded: the document must still come. If it has
//       not, the host is restarted on the same data directory.
//
// Each document may take 120 s to arrive; past that it counts as a failure,
// with what was observed. Everything made is a throwaway document; nothing is
// published. Results: one JSON line per measurement on stdout, a summary
// table at the end.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo-node";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const ONLY = (arg("--only") ?? "out,in,many,ack,term").split(",");
const KB = 1024;
const MB = 1024 * KB;
const parseSize = (s) => Math.round(parseFloat(s) * (/m$/i.test(s) ? MB : /k$/i.test(s) ? KB : 1));
const SIZES = arg("--sizes") ? arg("--sizes").split(",").map(parseSize) : [10 * KB, 100 * KB, MB, 5 * MB, 20 * MB];
const RUNS = arg("--runs") ? Number(arg("--runs")) : null;
const runsAt = (size) => RUNS ?? (size >= 20 * MB ? 3 : 5);
const LIMIT_MS = 120_000;
const TASK = "data:text/javascript," + encodeURIComponent(readFileSync(join(HERE, "write-path/task.js"), "utf8"));
const NOOP = "data:text/javascript," + encodeURIComponent("export default async (x) => x;");
const { run } = await import(join(ROOT, "dist-node/task-client.mjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
const label = (size) => (size >= MB ? `${size / MB} MB` : `${size / KB} KB`);
const say = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);
const rows = [];
const record = (row) => {
  rows.push(row);
  console.log(JSON.stringify(row));
};

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomBytes(size) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 65536) crypto.getRandomValues(bytes.subarray(at, Math.min(size, at + 65536)));
  return bytes;
}

/**
 * Finds `url` in `repo` until its content is `size` bytes hashing to `want`,
 * asking again 250 ms after a find rejects, for at most `limitMs`. Says when
 * it had it, and every rejection (when it came, and how long that find took).
 */
async function reach(repo, url, size, want, limitMs = LIMIT_MS) {
  const t0 = now();
  const deadline = t0 + limitMs;
  const rejections = [];
  let finds = 0;
  let firstFind = null;
  while (now() < deadline) {
    const at = Math.round(now() - t0);
    finds++;
    const got = await Promise.race([
      repo.find(url).then((handle) => ({ handle }), (error) => ({ error })),
      sleep(deadline - now()).then(() => ({ pending: true })),
    ]);
    const after = Math.round(now() - t0) - at;
    if (got.pending) {
      firstFind ??= { pendingAtLimit: true };
      return { ok: false, ms: Math.round(now() - t0), observed: `a find was still waiting at the limit (${finds} finds)`, finds, firstFind, rejections };
    }
    if (got.error) {
      firstFind ??= { rejectedAfterMs: after };
      rejections.push({ at, after, message: String(got.error?.message ?? got.error).replace(/Document \w+ /, "document ").slice(0, 60) });
      await sleep(250);
      continue;
    }
    firstFind ??= { resolvedAfterMs: after };
    for (;;) {
      const content = got.handle.doc()?.content;
      if (content?.byteLength === size && (await sha256(content)) === want) {
        return { ok: true, ms: Math.round(now() - t0), finds, firstFind, rejections };
      }
      if (now() > deadline) {
        return { ok: false, ms: Math.round(now() - t0), observed: content ? `found, ${content.byteLength} bytes not hashing right` : "found, no content", finds, firstFind, rejections };
      }
      await sleep(100);
    }
  }
  return { ok: false, ms: Math.round(now() - t0), observed: `never found (${finds} finds)`, finds, firstFind, rejections };
}
const shortRejections = (list) => ({ count: list.length, first: list.slice(0, 3), last: list.length > 3 ? list.at(-1) : undefined });

// ── hosts ──
const DIRS = [];
const hosts = [];
const freshDir = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `write-path-${name}-`));
  DIRS.push(dir);
  return dir;
};
function startHost(name, queue, dataDir) {
  const child = spawn(process.execPath, [join(ROOT, "dist-node/host.mjs"), "--queue", queue, "--data-dir", dataDir, "--workers", "1", "--name", name, "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
  const host = { name, child, lines: [], pool: null, exit: null };
  host.exited = new Promise((r) => child.on("exit", (code, signal) => ((host.exit = { code, signal, at: now() }), r(host.exit))));
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        host.lines.push({ at: now(), text });
        host.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[${name}] ${text}\n`);
      }
    });
  }
  hosts.push(host);
  return (async () => {
    const t0 = now();
    while (!host.pool) {
      if (host.exit || now() - t0 > 30_000) throw new Error(`host ${name} did not start: ${host.lines.map((l) => l.text).join(" | ")}`);
      await sleep(100);
    }
    return host;
  })();
}
const cleanup = () => {
  for (const h of hosts) if (h.exit === null) h.child.kill("SIGKILL");
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
};
process.on("exit", cleanup);

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
let exitCode = 0;
try {
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const newQueue = async (title) => {
    const queue = repo.create({ "@patchwork": { type: "task-queue-next" }, title, jobs: {} });
    await repo.flush();
    return queue.url;
  };
  const Q = await newQueue("write-path probe queue");
  const host = ONLY.some((s) => s !== "term") ? await startHost("write-path", Q, freshDir("host")) : null;
  let n = 0;
  /**
   * Asks and waits. The result carries `when`: when it was asked, when its
   * run started and ended (the host's clock, which is this machine's), and
   * when the asker read it succeeded.
   */
  const ask = async (input, queue = Q) => {
    const asked = Date.now();
    let last = null;
    const result = await run(repo, queue, { importUrl: TASK, input, key: `wp-${process.pid}-${n++}` }, (view) => (last = view));
    const done = Date.now();
    const ran = last?.runs?.find((r) => r.status === "succeeded");
    return { ...result, when: ran ? { toStart: ran.start - asked, ran: ran.end - ran.start, toAsker: done - ran.end } : null };
  };
  if (host) {
    const t0 = now();
    await within(60_000, run(repo, Q, { importUrl: NOOP, input: "warm", key: `wp-warm-${process.pid}` }), "the warm-up task");
    say(`host up; warm-up task took ${Math.round(now() - t0)} ms`);
  }

  /** One OUT: the task writes, the asker finds. */
  const out = async (kind, size, i, { ack = false, count = 1, queue = Q, onSucceeded = () => {} } = {}) => {
    const t0 = now();
    let result;
    try {
      result = await within(LIMIT_MS + 60_000, ask({ size, count, ack, limitMs: LIMIT_MS }, queue), "the writing task");
    } catch (error) {
      record({ kind, size, i, ok: false, observed: `task: ${error.message}` });
      return null;
    }
    const askMs = Math.round(now() - t0);
    onSucceeded();
    const t1 = now();
    const got = await Promise.all(result.docs.map((d) => reach(repo, d.url, size, d.sha256)));
    const reachMs = Math.round(now() - t1);
    const row = {
      kind,
      size,
      i,
      ok: got.every((g) => g.ok),
      askMs,
      when: result.when,
      taskMs: result.ms,
      flushedMs: result.flushedMs,
      ack: result.ack ?? undefined,
      reachMs,
      ...(count === 1 ? { firstFind: got[0].firstFind, finds: got[0].finds, rejections: shortRejections(got[0].rejections) } : { perDoc: got.map((g) => g.ms), rejections: got.reduce((a, g) => a + g.rejections.length, 0), failed: got.filter((g) => !g.ok).map((g) => g.observed) }),
      ...(got.some((g) => !g.ok) && count === 1 ? { observed: got[0].observed } : {}),
    };
    record(row);
    for (const d of result.docs) await repo.removeFromCache(d.url.slice("automerge:".length)).catch(() => {});
    return row;
  };

  if (ONLY.includes("out")) for (const size of SIZES) for (let i = 0; i < runsAt(size); i++) await out("out", size, i);

  if (ONLY.includes("in")) {
    for (const size of SIZES) {
      for (let i = 0; i < runsAt(size); i++) {
        const content = randomBytes(size);
        const want = await sha256(content);
        const handle = repo.create({ content });
        await repo.flush([handle.documentId]);
        const t0 = now();
        let result;
        try {
          result = await within(LIMIT_MS + 60_000, ask({ read: handle.url, sha256: want, size, limitMs: LIMIT_MS }), "the reading task");
        } catch (error) {
          record({ kind: "in", size, i, ok: false, observed: `task: ${error.message}` });
          continue;
        }
        record({ kind: "in", size, i, ok: result.ok, askMs: Math.round(now() - t0), when: result.when, taskMs: result.ms, firstFind: result.firstFind, finds: result.finds, rejections: result.rejections, ...(result.ok ? {} : { observed: result.observed }) });
        // what the server has is what is in question, not this Repo's copy
        await repo.removeFromCache(handle.documentId).catch(() => {});
      }
    }
  }

  if (ONLY.includes("many")) for (let i = 0; i < (RUNS ?? 3); i++) await out("many", 250 * KB, i, { count: 20 });

  if (ONLY.includes("ack")) for (const size of SIZES) for (let i = 0; i < runsAt(size); i++) await out("ack", size, i, { ack: true });

  if (ONLY.includes("term")) {
    for (let i = 0; i < (RUNS ?? 2); i++) {
      const QT = await newQueue("write-path probe queue, stopped host");
      const dir = freshDir("term");
      const T = await startHost(`term-${i}`, QT, dir);
      await within(60_000, run(repo, QT, { importUrl: NOOP, input: "warm", key: `wp-twarm-${process.pid}-${i}` }), "the warm-up task");
      let tTerm = null;
      const size = 5 * MB;
      const t0 = now();
      let result;
      try {
        result = await within(LIMIT_MS, ask({ size, limitMs: LIMIT_MS }, QT), "the writing task");
      } catch (error) {
        record({ kind: "term", i, ok: false, observed: `task: ${error.message}` });
        continue;
      }
      T.child.kill("SIGTERM");
      tTerm = now();
      const askMs = Math.round(tTerm - t0);
      const [doc] = result.docs;
      const first = await reach(repo, doc.url, size, doc.sha256);
      await T.exited;
      const row = { kind: "term", size, i, askMs, hostExit: { ...T.exit, afterSigtermMs: Math.round(T.exit.at - tTerm) }, hostSaid: T.lines.slice(-3).map((l) => l.text), whileStopped: { ok: first.ok, ms: first.ms, firstFind: first.firstFind, finds: first.finds, rejections: shortRejections(first.rejections), observed: first.observed } };
      if (!first.ok) {
        // A fresh peer, so that nothing this Repo remembers of its failed finds counts.
        const fresh = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
        const R = await startHost(`term-${i}-again`, QT, dir);
        const tRestart = now();
        const second = await reach(fresh, doc.url, size, doc.sha256, 60_000);
        row.afterRestart = { ok: second.ok, ms: second.ms, firstFind: second.firstFind, finds: second.finds, rejections: shortRejections(second.rejections), observed: second.observed };
        await fresh.shutdown().catch(() => {});
        R.child.kill("SIGTERM");
        await within(20_000, R.exited, "the restarted host stopping").catch(() => R.child.kill("SIGKILL"));
      }
      record(row);
    }
  }

  if (host) {
    host.child.kill("SIGTERM");
    await within(20_000, host.exited, "the host stopping").catch(() => host.child.kill("SIGKILL"));
  }

  // the summary
  const table = [];
  for (const kind of ["out", "in", "ack", "many"]) {
    const sizes = [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.size))];
    for (const size of sizes) {
      const of = rows.filter((r) => r.kind === kind && r.size === size);
      const ok = of.filter((r) => r.ok);
      const measure = kind === "in" ? (r) => r.taskMs : (r) => r.reachMs;
      table.push({
        kind,
        size: label(size),
        ask: ok.length ? `${median(ok.map((r) => r.askMs))} / ${Math.max(...ok.map((r) => r.askMs))}` : "-",
        arrive: ok.length ? `${median(ok.map(measure))} / ${Math.max(...ok.map(measure))}` : "-",
        failures: `${of.length - ok.length} of ${of.length}`,
        rejections: of.map((r) => (typeof r.rejections === "number" ? r.rejections : r.rejections?.count ?? 0)).join(","),
        ...(kind === "ack" ? { ackWait: ok.length ? `${median(ok.map((r) => r.ack?.ms ?? 0))} / ${Math.max(...ok.map((r) => r.ack?.ms ?? 0))}` : "-", acked: of.map((r) => (r.ack?.acked ? "y" : "n")).join("") } : {}),
      });
    }
  }
  console.error("\nmedian / worst ms; ask = asked to succeeded; arrive = succeeded to the asker having it (out, ack, many) or the task's start to its having it (in)");
  console.table(table);
  await repo.shutdown().catch(() => {});
} catch (error) {
  say("probe stopped:", error?.stack ?? error);
  exitCode = 1;
}
cleanup();
process.exit(exitCode);
