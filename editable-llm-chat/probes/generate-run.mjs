// Replies written as tasks on Node hosts, end to end, through the real sync
// server, with a stand-in provider on this machine so that nothing is paid
// for.
//
//   (in tasks/: pnpm build:node; then in editable-llm-chat/) node probes/generate-run.mjs [--sync wss://…] [--verbose]
//
// Two hosts (TASKS_HOST, by default ../tasks/dist-node/host.mjs, real
// processes with fresh data directories) serve a new queue and run this
// directory as a made-up package (--local). The stand-in provider is a local
// HTTP server that streams a known text as server-sent events, one piece at a
// time, slowly. This process is the asker: a Repo of its own makes a chat with
// a question and an empty reply, and asks for the reply through
// ../tasks/dist-node/task-client.mjs as the tool's doWork would ask the
// person's queue, with the input and key from src/reply.js; it keeps every
// text of the reply its own Repo sees, and reads the chat's history after.
//
// Checks, one line each, with what was seen:
// 1. a reply is written once (one run, none yielded) with both hosts serving,
//    grows by appends at the end of the reply, seen at several lengths on the
//    way, and ends finished as the known text;
// 2. a stop mid-stream ends the task cancelled and the reply stopped, keeping
//    what was streamed, and the provider's request is closed;
// 3. the host writing a reply killed mid-stream: the other takes the task
//    after the lapse, removes the lost text once, and the reply ends as one
//    clean copy of the known text;
// 4. the hosts said nothing went wrong.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge";
import { replyAsk } from "../src/reply.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(HERE, "..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const HOST = resolve(process.env.TASKS_HOST ?? join(PACKAGE_DIR, "../tasks/dist-node/host.mjs"));
if (!existsSync(HOST) || !existsSync(join(dirname(HOST), "task-client.mjs"))) {
  console.error(`probe stopped: no tasks host at ${HOST} (build it in ../tasks with pnpm build:node)`);
  process.exit(2);
}
const { ask, cancel, run } = await import(join(dirname(HOST), "task-client.mjs"));

// a made-up package that this directory stands for, and the task's file in it as a browser names it
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKG = `automerge:${Array.from({ length: 28 }, () => BASE58[Math.floor(Math.random() * 58)]).join("")}`;
const IMPORT_URL = `/${encodeURIComponent(PKG)}/src/generate-task.js`;

const API_KEY = "sk-stand-in-not-a-real-key";
const WORDS = "The quick brown fox jumps over the lazy dog while the slow green turtle counts every pebble along the quiet shore of the little bay at dawn".split(" ");
const PIECES = WORDS.map((w, i) => (i ? ` ${w}` : w));
const TEXT = PIECES.join("");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const until = async (test, ms, what, every = 100) => {
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
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : J(saw)}`);
};
setTimeout(() => (console.error("TIMEOUT"), process.exit(2)), 4 * 60_000).unref();

// ── the stand-in provider: the model's name says how long each piece takes ──
const provider = { requests: [] };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const seen = { at: Date.now(), closedAt: null, sent: 0, auth: req.headers.authorization ?? null };
    provider.requests.push(seen);
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":{"message":"No auth credentials found"}}');
    }
    const everyMs = Number(/^stand-in:(\d+)$/.exec(JSON.parse(body).model)?.[1] ?? 100);
    res.on("close", () => (seen.closedAt ??= Date.now()));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of PIECES) {
      await sleep(everyMs);
      if (seen.closedAt) return;
      res.write(`data: ${J({ choices: [{ delta: { content: piece } }] })}\n\n`);
      seen.sent++;
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;

// ── the hosts ──
const hosts = [];
const DIRS = [];
function startHost(label, queueArgs) {
  const dataDir = mkdtempSync(join(tmpdir(), `chat-generate-${label}-`));
  DIRS.push(dataDir);
  const child = spawn(process.execPath, [HOST, ...queueArgs, "--local", `${PKG}=${PACKAGE_DIR}`, "--data-dir", dataDir, "--workers", "2", "--name", `chat-probe-${label}`, "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
  const host = { label, child, lines: [], queue: null, pool: null, exit: null, killedAt: null };
  child.on("exit", (code, signal) => (host.exit = { code, signal }));
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        host.lines.push({ at: Date.now(), text });
        host.queue ??= /made the queue "[^"]*": (automerge:\S+)/.exec(text)?.[1] ?? null;
        host.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[${label}] ${text}\n`);
      }
    });
  }
  hosts.push(host);
  return host;
}
const cleanup = () => {
  for (const h of hosts) if (h.exit === null) h.child.kill("SIGKILL");
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
};
process.on("exit", cleanup);

/**
 * The reply's history as the asker has it: every change not made by this
 * Repo, each as its patches, read for how it touched the reply's text.
 */
function howWritten(handle) {
  const doc = handle.doc();
  const mine = A.getActorId(doc);
  const theirs = A.getAllChanges(doc)
    .map((c) => A.decodeChange(c))
    .filter((c) => c.actor !== mine)
    .map((c) => ({ run: c.actor, patches: A.diff(doc, c.deps, [c.hash]) }));
  const onText = (p) => p.path[0] === "messages" && p.path[2] === "content";
  const appends = theirs.filter((c) => c.patches.some((p) => onText(p) && p.action === "splice"));
  const deletes = theirs.filter((c) => c.patches.some((p) => onText(p) && p.action === "del"));
  // within one run's appends, each splice lands where that run's text ended
  let atEnd = 0;
  let length = 0;
  let lastRun = null;
  for (const c of appends) {
    const [p, ...more] = c.patches.filter(onText);
    if (c.run !== lastRun) length = 0;
    lastRun = c.run;
    if (!more.length && p.action === "splice" && p.path[3] === length) atEnd++;
    length += p.value?.length ?? 0;
  }
  return { changes: theirs.length, appends: appends.length, atEnd, deletes: deletes.map((c) => c.patches.filter(onText).map((p) => p.length ?? 1)) };
}

/** A chat with a question and an empty reply, its id `reply`, made in the asker's Repo and on the server. */
async function makeChat(repo, reply) {
  const chat = repo.create({
    "@patchwork": { type: "editable-llm-chat" },
    config: { apiUrl: ENDPOINT.replace(/\/chat\/completions$/, ""), model: "m" },
    messages: [
      { id: "q", role: "user", content: "Tell me about the bay." },
      { id: reply, role: "assistant", content: "" },
    ],
  });
  await repo.flush();
  return chat;
}

/** Asks for the reply as the tool would, keeping every text of it the asker sees and every view of its task. */
function askReply(repo, queue, chat, reply, everyMs) {
  const request = { endpoint: ENDPOINT, model: `stand-in:${everyMs}`, messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: "Tell me about the bay." }] };
  const { input, key } = replyAsk(chat.url, reply, request, API_KEY);
  const texts = [];
  const views = [];
  const text = () => chat.doc().messages.find((m) => m.id === reply)?.content ?? null;
  chat.on("change", () => texts.push(text()));
  const done = run(repo, queue, { importUrl: IMPORT_URL, input, key }, (v) => views.push(v)).then(
    (result) => ({ result }),
    (error) => ({ error: String(error?.message ?? error) }),
  );
  return { key, texts, views, done, text, message: () => chat.doc().messages.find((m) => m.id === reply) };
}

const between = (texts) => [...new Set(texts.filter((t) => typeof t === "string" && t.length > 0 && t.length < TEXT.length).map((t) => t.length))];
const allPrefixes = (texts) => texts.every((t) => t === null || TEXT.startsWith(t));
const taskOf = async (repo, views) => {
  const url = views.findLast((v) => v.taskUrl)?.taskUrl;
  return url ? (await repo.find(url)).doc() : null;
};

let killedAt = null;
try {
  const a = startHost("a", ["--new-queue", "editable chat probe"]);
  await until(async () => a.queue && a.pool, 60_000, "host a making its queue and saying who it is");
  const b = startHost("b", ["--queue", a.queue]);
  await until(async () => b.pool, 60_000, "host b saying who it is");
  const Q = a.queue;
  const hostOf = (pool) => (pool === a.pool ? "a" : pool === b.pool ? "b" : pool ? pool.slice(0, 8) : "?");
  console.error(`  hosts: a ${a.pool}, b ${b.pool}; queue ${Q}; package ${PKG} = ${PACKAGE_DIR}; provider ${ENDPOINT}`);
  // each pool hears the other on the queue before it may be preferred (a beat and a little)
  await sleep(5_000);

  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });

  // 1: one reply, both hosts serving
  {
    const chat = await makeChat(repo, "r1");
    const before = provider.requests.length;
    const t0 = Date.now();
    const asked = askReply(repo, Q, chat, "r1", 150);
    const { result, error } = await asked.done;
    const ms = Date.now() - t0;
    const message = await until(async () => (asked.message()?.ended ? asked.message() : null), 30_000, "the reply ended in the asker's Repo").catch(() => asked.message());
    const task = await taskOf(repo, asked.views);
    const runs = task?.runs ?? [];
    const how = howWritten(chat);
    const lengths = between(asked.texts);
    check(
      1,
      "a reply with two hosts serving: written once, by appends at the end, seen growing, finished as the known text",
      result?.ended === "finished" && message?.ended === "finished" && message.content === TEXT && runs.length === 1 && runs[0].status === "succeeded" && how.appends === PIECES.length && how.atEnd === PIECES.length && how.deletes.length === 0 && lengths.length >= 3 && allPrefixes(asked.texts) && provider.requests.length - before === 1,
      { ms, result, error, ended: message?.ended, textIsKnown: message?.content === TEXT, runs: runs.map((r) => `${hostOf(r.pool)}:${r.status}`), yielded: runs.filter((r) => r.status === "yielded").length, providerRequests: provider.requests.length - before, history: how, pieces: PIECES.length, lengthsSeen: lengths.length, everySeenAPrefix: allPrefixes(asked.texts) },
    );
  }

  // 2: a stop mid-stream
  {
    const chat = await makeChat(repo, "r2");
    const asked = askReply(repo, Q, chat, "r2", 300);
    await until(async () => (asked.text()?.length ?? 0) >= PIECES.slice(0, 4).join("").length, 60_000, "four pieces of the reply");
    const req = provider.requests.at(-1);
    const tStop = Date.now();
    const stopped = await cancel(repo, Q, asked.key);
    const { result, error } = await asked.done;
    const message = await until(async () => (asked.message()?.ended ? asked.message() : null), 30_000, "the reply marked ended").catch(() => asked.message());
    const atEnd = message?.content ?? null;
    await sleep(1_500);
    const later = asked.text();
    check(
      2,
      "a stop mid-stream: the task is cancelled, the reply marked stopped with what was streamed, the provider's request closed",
      stopped === true && error === "The task was cancelled" && message?.ended === "stopped" && typeof atEnd === "string" && atEnd.length > 0 && atEnd.length < TEXT.length && TEXT.startsWith(atEnd) && later === atEnd && req.closedAt !== null && req.closedAt - tStop < 6_000,
      { stopped, result, error, ended: message?.ended, kept: atEnd, grewAfter: later !== atEnd, providerClosedAfterMs: req.closedAt === null ? null : req.closedAt - tStop, piecesSent: req.sent, stopToEndedMs: Date.now() - tStop - 1_500 },
    );
  }

  // 3: the host writing a reply killed mid-stream
  {
    const chat = await makeChat(repo, "r3");
    const before = provider.requests.length;
    const asked = askReply(repo, Q, chat, "r3", 300);
    await until(async () => (asked.text()?.length ?? 0) >= PIECES.slice(0, 4).join("").length, 60_000, "four pieces of the reply");
    const task = await until(() => taskOf(repo, asked.views), 10_000, "the task's document");
    const open = task.runs.find((r) => !r.status);
    const victim = open?.pool === a.pool ? a : open?.pool === b.pool ? b : null;
    if (!victim) throw new Error(`no host holds the reply's run: ${J(task.runs)}`);
    const lost = asked.text();
    victim.child.kill("SIGKILL");
    killedAt = victim.killedAt = Date.now();
    const { result, error } = await Promise.race([asked.done, sleep(120_000).then(() => ({ error: "no ending in 120 s after the kill" }))]);
    const message = await until(async () => (asked.message()?.ended ? asked.message() : null), 30_000, "the reply ended").catch(() => asked.message());
    const after = await taskOf(repo, asked.views);
    const how = howWritten(chat);
    check(
      3,
      "the host writing a reply killed mid-stream: the other takes it after the lapse, removes the lost text once, and the reply is one clean copy",
      result?.ended === "finished" && message?.ended === "finished" && message.content === TEXT && how.deletes.length === 1 && how.deletes[0].length === 1 && how.deletes[0][0] === lost.length && after.runs.some((r) => r.status === "succeeded" && r.pool === (victim === a ? b : a).pool) && provider.requests.length - before === 2,
      { killed: victim.label, lostText: lost.length, result, error, ended: message?.ended, textIsKnown: message?.content === TEXT, deletes: how.deletes, appends: how.appends, runs: after.runs.map((r) => `${hostOf(r.pool)}:${r.status ?? "open"}`), providerRequests: provider.requests.length - before, killToEndMs: Date.now() - killedAt },
    );
  }

  // what a killed host's task prints once its parent is gone is not the host's doing
  const problems = hosts.flatMap((h) => h.lines.filter((l) => (!h.killedAt || l.at < h.killedAt) && /error|crash|threw|uncaught/i.test(l.text)).map((l) => `${h.label}: ${l.text}`));
  check(4, "the hosts said nothing went wrong", problems.length === 0, problems.length ? J(problems.slice(0, 5)) : "nothing");
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
}
for (const h of hosts) if (h.exit === null) h.child.kill("SIGTERM");
for (const t0 = Date.now(); hosts.some((h) => h.exit === null) && Date.now() - t0 < 10_000; ) await sleep(100);
server.close();
process.exit(failed ? 1 : 0);
