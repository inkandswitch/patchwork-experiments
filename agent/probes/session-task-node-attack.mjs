// A checker's variations on probes/session-task-node.mjs: the session task
// (runners/session-task.js) on two Node hosts through the real sync server,
// pushed where the first probe does not go.
//
//   (after `pnpm build:node` in tasks/) node probes/session-task-node-attack.mjs [--only both,early,...] [--scratch dir] [--verbose]
//
// The model is a stand-in on this machine that can also answer with tool
// calls, reached through the input's `providerUrl`, with made-up keys. This
// process is the asker. Scenarios, in this order (each prints its checks):
//
//   both     two hosts started at once on a queue already listing three
//            bursts: each burst runs once, and the model is asked once per
//            session (a run that yields asks nothing)
//   early    a stop written before the run has settled (nothing written, no
//            request), and one written after the model was asked and before
//            its first token (the request dropped, 'stopped', no reply text)
//   tools    a worker tool (doc_read) runs on the host and its result goes
//            back to the model in the same burst; a page tool (doc_create)
//            parks and the burst ends 'parked' with one request
//   sensitive  doc_read of the own queue asks; doc_read of the session's own
//            task is refused and its keys never reach the model
//   message  a message written by the asker while the burst streams is
//            answered in the same burst; askWork (with a client over the
//            same queue) then does not ask again; and the same message from a
//            page that asks and then closes is still answered
//   offline  the stand-in unreachable: the session says it is reconnecting,
//            the task does not fail, and the burst carries on when it is back
//   kill9    kill -9 of the host running a burst mid-reply: the other host
//            retakes it after the lapse, drops the marked reply and finishes
//
// After every scenario: the made-up keys are nowhere but the tasks' inputs
// (sessions' whole histories, the queue, results, run records, everything the
// hosts printed), and no session ever held a task's url or the queue's.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge";
import { run, watch, cancel, findWhenThere } from "../host/task-client.js";
import { initSession } from "../session/schema.js";
import { makeTurn, textBlock } from "../session/blocks.js";
import { stopSession } from "../session/recovery.js";
import { STOP } from "../session/status.js";
import { noteWrite } from "../knowledge/notes.js";
import { workKey, askWork, forget } from "../runners/ask.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, "..");
const HOST = join(AGENT, "../tasks/dist-node/host.mjs");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const SCRATCH = arg("--scratch") ?? process.env.PROBE_SCRATCH ?? tmpdir();
const ONLY = arg("--only")?.split(",") ?? null;
const wants = (name) => !ONLY || ONLY.includes(name);
// Made up, from fixed bytes: the package the hosts run from this directory.
const PKG = stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(9) });
const IMPORT = `/${encodeURIComponent(PKG)}/runners/session-task.js`;
const MODEL_KEY = "made-up-model-key-c4e8b1";
const SEARCH_KEY = "made-up-search-key-92af07";
const KEYS = [MODEL_KEY, SEARCH_KEY];

const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
let failed = false;
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : J(saw)}`);
};

// ---- The stand-in model: text pieces, or tool calls, by the session's tag.
const frame = (delta, finish = null) => `data: ${J({ choices: [{ delta, finish_reason: finish }] })}\n\n`;
const firstUser = (body) => {
  const user = (body?.messages ?? []).find((m) => m.role === "user");
  return typeof user?.content === "string" ? user.content : J(user?.content ?? "");
};
const allText = (body) => J(body?.messages ?? []);
const tagOf = (body) => /\((\w+)\)/.exec(firstUser(body))?.[1] ?? "plain";
const hasToolResult = (body) => (body?.messages ?? []).some((m) => m.role === "tool");
const requests = [];
const scripts = {}; // tag -> (body, seen) => { pieces, everyMs, firstDelayMs, calls }
const scriptFor = (body) => (scripts[tagOf(body)] ?? (() => ({ pieces: ["Fine."], everyMs: 200 })))(body);
const handler = (req, res) => {
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {}
    const seen = { n: requests.length, at: Date.now(), tag: tagOf(body), authorization: req.headers.authorization ?? null, body, done: false, aborted: false, sent: 0 };
    requests.push(seen);
    if (req.method !== "POST" || !/\/chat\/completions$/.test(req.url)) return void res.writeHead(404).end();
    const { pieces = [], everyMs = 200, firstDelayMs = 0, calls = [] } = scriptFor(body) ?? {};
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    let i = 0;
    let timer = null;
    res.on("close", () => {
      clearTimeout(timer);
      if (!seen.done) seen.aborted = true;
    });
    const next = () => {
      if (res.destroyed) return;
      if (i < pieces.length) {
        res.write(frame({ content: pieces[i++] }));
        seen.sent = i;
        timer = setTimeout(next, everyMs);
        return;
      }
      calls.forEach((c, k) => res.write(frame({ tool_calls: [{ index: k, id: c.id, type: "function", function: { name: c.name, arguments: J(c.args) } }] })));
      res.write(frame({}, calls.length ? "tool_calls" : "stop"));
      res.write(`data: ${J({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: pieces.length + 1 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      seen.done = true;
    };
    timer = setTimeout(next, firstDelayMs);
  });
};
const server = createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const PORT = server.address().port;
const STAND = `http://127.0.0.1:${PORT}`;
let up = true;
const standDown = () =>
  new Promise((resolve) => {
    up = false;
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
const standUp = () => new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => ((up = true), resolve())));

mkdirSync(SCRATCH, { recursive: true });
const dirs = [];
const hosts = [];
const cleanup = () => {
  for (const h of hosts) if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill("SIGKILL");
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};
process.on("exit", cleanup);
setTimeout(() => (console.error("TIMEOUT"), cleanup(), process.exit(2)), 12 * 60_000).unref();

function startHost(label, queueArgs) {
  const dataDir = mkdtempSync(join(SCRATCH, `host-${label}-`));
  dirs.push(dataDir);
  const child = spawn(process.execPath, [HOST, ...queueArgs, "--local", `${PKG}=${AGENT}`, "--data-dir", dataDir, "--workers", "1", "--name", `agent-attack-${label}`, "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
  const host = { label, child, lines: [], pool: null, queue: null };
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      for (const text of parts) {
        host.lines.push(text);
        host.pool ??= /: pool ([0-9a-f-]{36}),/.exec(text)?.[1] ?? null;
        host.queue ??= /^made the queue "[^"]*": (automerge:\S+)/.exec(text)?.[1] ?? null;
        if (VERBOSE) process.stderr.write(`[${label}] ${text}\n`);
      }
    });
  }
  hosts.push(host);
  return host;
}
async function untilSaid(host, what, ms = 30_000) {
  for (const t0 = Date.now(); !what(host); await sleep(100)) {
    if (Date.now() - t0 > ms || host.child.exitCode !== null) throw new Error(`host ${host.label} did not start: ${J(host.lines.slice(-6))}`);
  }
}
const alive = (h) => h.child.exitCode === null && h.child.signalCode === null;
async function stopHost(h, signal = "SIGTERM") {
  h.child.kill(signal);
  for (const t0 = Date.now(); alive(h) && Date.now() - t0 < 12_000; ) await sleep(100);
}

const everHeld = (doc) => J(A.getAllChanges(doc).map((c) => A.decodeChange(c).ops));
function replyOf(doc) {
  const turn = (doc?.turns ?? []).findLastIndex((t) => t.role === "assistant");
  const blocks = doc?.turns?.[turn]?.blocks ?? [];
  const block = blocks.findLastIndex((b) => b.type === "text");
  return { turn, block, id: doc?.turns?.[turn]?.id ?? null, text: blocks[block]?.text ?? "", streaming: doc?.turns?.[turn]?.streaming ?? null };
}
const marksOf = (doc) => (doc?.turns ?? []).filter((t) => t.streaming).length + (doc?.turns ?? []).flatMap((t) => t.blocks ?? []).filter((b) => b.type === "call" && b.status === "running").length;
const of = (tag) => requests.filter((r) => r.tag === tag);

let repo;
const sessions = []; // { handle, taskUrls: Set }
const taskUrls = new Set();
let queueUrl = null;
try {
  await initSubduction();
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const root = repo.create({ title: "Root", docs: [], "@patchwork": { type: "folder" } });
  await noteWrite.execute({ name: "Boat names", content: "# Boat names\nThe ketch is called Merlin.\n" }, { repo, rootFolderUrl: root.url, splice: A.splice });

  const newSession = (words) => {
    const handle = repo.create();
    handle.change((d) => {
      initSession(d, {});
      d.config.model = "made-up/model";
      d.turns.push(makeTurn("user", [textBlock(words)]));
      d.burst = null;
    });
    sessions.push(handle);
    return handle;
  };
  const inputOf = (session, sensitiveDocs = []) => ({
    session: session.url,
    heads: [...session.heads()],
    account: { rootFolderUrl: root.url, sensitiveDocs },
    catalogue: { tools: [], skills: [] },
    providerUrl: STAND,
    keys: { model: MODEL_KEY, search: SEARCH_KEY, relay: null },
  });
  const ask = (session, sensitiveDocs = []) => {
    const views = [];
    const result = run(repo, queueUrl, { importUrl: IMPORT, input: inputOf(session, sensitiveDocs), key: workKey(session.url) }, (view) => {
      views.push(view);
      if (view?.taskUrl) taskUrls.add(view.taskUrl);
    }).catch((error) => ({ error: String(error?.message ?? error) }));
    return { result, views };
  };
  const byPool = (pool) => hosts.find((h) => h.pool === pool) ?? null;
  const runsOf = (views) => (views.at(-1)?.runs ?? []).map((r) => `${byPool(r.pool)?.label ?? "?"}:${r.status ?? "open"}`);

  // The queue, made by a host that is then stopped, so the next two start together.
  const Q = startHost("q", ["--new-queue", "agent attack probe"]);
  await untilSaid(Q, (h) => h.pool && h.queue);
  queueUrl = Q.queue;
  // Had here (so on the sync server) before the host that made it goes.
  await within(60_000, findWhenThere(repo, queueUrl), "the queue the first host made");
  await sleep(2000);
  await stopHost(Q);

  let H1;
  let H2;
  // ---- both: three bursts listed, then two hosts started at once.
  if (wants("both")) {
    scripts.both = () => ({ pieces: ["One ", "answer ", "each."], everyMs: 300 });
    const three = [0, 1, 2].map((i) => newSession(`Burst ${i}, asked before any host serves the queue. (both)`));
    const asked = three.map((s) => ask(s));
    await sleep(1500);
    H1 = startHost("a", ["--queue", queueUrl]);
    H2 = startHost("b", ["--queue", queueUrl]);
    await Promise.all([untilSaid(H1, (h) => h.pool), untilSaid(H2, (h) => h.pool)]);
    const results = await Promise.all(asked.map((a) => within(150_000, a.result, "a burst asked before the hosts started").catch((e) => ({ error: e.message }))));
    const perSession = three.map((s) => requests.filter((r) => firstUser(r.body).includes(s.doc().turns[0].blocks[0].text)).length);
    const runs = asked.map((a) => runsOf(a.views));
    const replies = three.map((s) => (s.doc().turns ?? []).filter((t) => t.role === "assistant").length);
    check(
      "both",
      "two hosts started at once on three listed bursts: each burst ends idle, one model request and one reply per session",
      results.every((r) => r?.outcome === "idle") && perSession.every((n) => n === 1) && replies.every((n) => n === 1) && three.every((s) => s.doc().burst === null && marksOf(s.doc()) === 0),
      `outcomes ${J(results.map((r) => r?.outcome ?? r?.error))}; requests per session ${J(perSession)}; runs ${J(runs)}; assistant turns ${J(replies)}`,
    );
  } else {
    H1 = startHost("a", ["--queue", queueUrl]);
    H2 = startHost("b", ["--queue", queueUrl]);
    await Promise.all([untilSaid(H1, (h) => h.pool), untilSaid(H2, (h) => h.pool)]);
    await sleep(3000);
  }

  // ---- early: a stop before settled, and a stop before the first token.
  if (wants("early")) {
    scripts.early1 = () => ({ pieces: ["Never ", "sent."], everyMs: 300 });
    {
      const session = newSession("Stopped before the run settles. (early1)");
      const asked = ask(session);
      await sleep(300);
      const burstBefore = session.doc().burst;
      session.change((d) => stopSession(d, STOP.stopped, null, null));
      const result = await within(60_000, asked.result, "a burst stopped before it settled").catch((e) => ({ error: e.message }));
      const doc = session.doc();
      check(
        "early.1",
        "a stop written before the run settled: the burst ends 'stopped', no model request, no burst mark written",
        result?.outcome === "stopped" && of("early1").length === 0 && doc.burst === null && marksOf(doc) === 0,
        `burst before the stop ${J(burstBefore)}; ${J(result)}; requests ${of("early1").length}; runs ${J(runsOf(asked.views))}; turns ${J(doc.turns.map((t) => `${t.role}:${(t.blocks ?? []).map((b) => b.type + (b.kind ? "/" + b.kind : "")).join("+")}`))}; burst ${J(doc.burst)}`,
      );
    }
    scripts.early2 = () => ({ pieces: ["Too ", "late."], everyMs: 300, firstDelayMs: 6000 });
    {
      const session = newSession("Stopped before the first token. (early2)");
      const asked = ask(session);
      let at = null;
      for (const t0 = Date.now(); Date.now() - t0 < 60_000; await sleep(50)) {
        if (of("early2").length) {
          session.change((d) => stopSession(d, STOP.stopped, null, null));
          at = Date.now();
          break;
        }
      }
      const result = await within(60_000, asked.result, "a burst stopped before its first token").catch((e) => ({ error: e.message }));
      const ms = at ? Date.now() - at : null;
      const req = of("early2")[0];
      const doc = session.doc();
      const texts = doc.turns.filter((t) => t.role === "assistant").flatMap((t) => t.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text);
      check(
        "early.2",
        "a stop written after the model was asked and before its first token: the request is dropped, the burst ends 'stopped' within a sync delay, nothing marked",
        result?.outcome === "stopped" && req?.aborted === true && req?.sent === 0 && ms !== null && ms < 10_000 && doc.burst === null && marksOf(doc) === 0 && of("early2").length === 1,
        `ended ${ms} ms after the stop: ${J(result)}; request aborted ${req?.aborted}, pieces sent ${req?.sent}; requests ${of("early2").length}; assistant texts ${J(texts)}; burst ${J(doc.burst)}; marks ${marksOf(doc)}`,
      );
    }
  }

  // ---- tools: a worker tool runs on the host; a page tool parks.
  if (wants("tools")) {
    scripts.tools = (body) => (hasToolResult(body) ? { pieces: ["Read ", "it."], everyMs: 200 } : { pieces: ["Reading. "], everyMs: 100, calls: [{ id: "call_w1", name: "doc_read", args: { url: root.url } }] });
    {
      const session = newSession("Read the root folder. (tools)");
      const asked = ask(session);
      const result = await within(120_000, asked.result, "a burst with a worker tool").catch((e) => ({ error: e.message }));
      const doc = session.doc();
      const call = doc.turns.flatMap((t) => t.blocks ?? []).find((b) => b.type === "call");
      const resultBlock = doc.turns.flatMap((t) => t.blocks ?? []).find((b) => b.type === "result" || b.type === "tool_result");
      const second = of("tools")[1];
      const toolMsg = (second?.body?.messages ?? []).find((m) => m.role === "tool");
      check(
        "tools.1",
        "a worker tool (doc_read) runs on the host in the burst, and its result goes back to the model in the same burst",
        result?.outcome === "idle" && of("tools").length === 2 && !!toolMsg && J(toolMsg).includes("Agent notes") && call?.status === "done" && doc.burst === null && marksOf(doc) === 0,
        `${J(result)}; requests ${of("tools").length}; call ${J({ tool: call?.tool, status: call?.status, runner: call?.runner ?? null })}; result block ${resultBlock ? "present" : "absent"}; the tool message sent ${toolMsg ? (J(toolMsg).includes("Agent notes") ? "names the notes folder" : J(toolMsg).slice(0, 160)) : "absent"}; runs ${J(runsOf(asked.views))}`,
      );
    }
    scripts.page = () => ({ pieces: ["Making it. "], everyMs: 100, calls: [{ id: "call_p1", name: "doc_create", args: { datatype: "folder", title: "Made by a page" } }] });
    {
      const session = newSession("Make a folder. (page)");
      const asked = ask(session);
      const result = await within(120_000, asked.result, "a burst with a page tool").catch((e) => ({ error: e.message }));
      await sleep(1500);
      const doc = session.doc();
      const call = doc.turns.flatMap((t) => t.blocks ?? []).find((b) => b.type === "call");
      check(
        "tools.2",
        "a page tool (doc_create) parks: the burst ends 'parked' after one request, the call left approved for a page, burst cleared",
        result?.outcome === "parked" && of("page").length === 1 && call?.status === "approved" && call?.where === "host" && doc.burst === null,
        `${J(result)}; requests ${of("page").length}; call ${J({ tool: call?.tool, status: call?.status, where: call?.where ?? null })}; burst ${J(doc.burst)}; runs ${J(runsOf(asked.views))}`,
      );
    }
  }

  // ---- sensitive: a read of the own queue asks; a read of the session's own task is refused.
  if (wants("sensitive")) {
    scripts.queue = () => ({ pieces: ["Looking at the queue. "], everyMs: 100, calls: [{ id: "call_q1", name: "doc_read", args: { url: queueUrl } }] });
    {
      const session = newSession("Read the queue. (queue)");
      const asked = ask(session, [queueUrl]);
      const result = await within(120_000, asked.result, "a burst reading the own queue").catch((e) => ({ error: e.message }));
      const doc = session.doc();
      const call = doc.turns.flatMap((t) => t.blocks ?? []).find((b) => b.type === "call");
      const results = doc.turns.flatMap((t) => t.blocks ?? []).filter((b) => b.type === "result" || b.type === "tool_result");
      check(
        "sensitive.1",
        "in a burst on a host, doc_read of the own queue (in the input's sensitiveDocs) asks: the call is left pending, no result, one request, the burst ends awaiting approval",
        result?.outcome === "awaiting-approval" && call?.status === "pending" && results.length === 0 && of("queue").length === 1 && doc.burst === null,
        `${J(result)}; call ${J({ tool: call?.tool, status: call?.status, always: call?.ask?.always ?? null })}; results ${results.length}; requests ${of("queue").length}; burst ${J(doc.burst)}`,
      );
    }
    let ownTask = null;
    scripts.owntask = (body) => (hasToolResult(body) ? { pieces: ["Could not."], everyMs: 100 } : { pieces: ["Reading my task. "], everyMs: 100, calls: [{ id: "call_t1", name: "doc_read", args: { url: ownTask } }] });
    {
      const session = newSession("Read your own task. (owntask)");
      const asked = ask(session);
      for (const t0 = Date.now(); !asked.views.at(-1)?.taskUrl && Date.now() - t0 < 30_000; ) await sleep(50);
      ownTask = asked.views.at(-1)?.taskUrl ?? null;
      const result = await within(120_000, asked.result, "a burst reading its own task").catch((e) => ({ error: e.message }));
      const doc = session.doc();
      const call = doc.turns.flatMap((t) => t.blocks ?? []).find((b) => b.type === "call");
      const toolMsg = (of("owntask")[1]?.body?.messages ?? []).find((m) => m.role === "tool");
      check(
        "sensitive.2",
        "in a burst on a host, doc_read of the session's own task (its url handed to the model) is refused: the tool message sent back holds no key, the burst ends idle",
        !!ownTask && result?.outcome === "idle" && !!toolMsg && !KEYS.some((k) => J(toolMsg).includes(k)) && !KEYS.some((k) => everHeld(doc).includes(k)),
        `task url known ${!!ownTask}; ${J(result)}; call ${J({ tool: call?.tool, status: call?.status })}; tool message ${toolMsg ? J(toolMsg.content ?? toolMsg).slice(0, 220) : "absent"}; requests ${of("owntask").length}`,
      );
    }
  }

  // ---- message: written while the burst streams; askWork then asks nothing more.
  if (wants("message")) {
    scripts.message = (body) => (allText(body).includes("(second)") ? { pieces: ["And ", "that ", "too."], everyMs: 200 } : { pieces: Array.from({ length: 10 }, (_, i) => `part${i} `), everyMs: 400 });
    const session = newSession("Tell me something long. (message)");
    const client = {
      doWork: (r, req) => run(r, queueUrl, { ...req, importUrl: IMPORT, input: { ...req.input, providerUrl: STAND } }, (view) => view?.taskUrl && taskUrls.add(view.taskUrl)),
      watchWork: (r, key, cb) => watch(r, queueUrl, key, cb),
      stopWork: (r, key) => cancel(r, queueUrl, key).then(() => true),
    };
    const opts = { client, importUrl: IMPORT, account: { rootFolderUrl: root.url, sensitiveDocs: [] }, keys: { model: MODEL_KEY, search: SEARCH_KEY, relay: null } };
    await sleep(500); // the watch's first word
    const first = askWork(repo, session.url, opts).catch((e) => ({ error: e.message }));
    let wroteAt = null;
    for (const t0 = Date.now(); Date.now() - t0 < 90_000; await sleep(100)) {
      const reply = replyOf(session.doc());
      if (reply.streaming && reply.text.split(" ").length > 3) {
        session.change((d) => d.turns.push(makeTurn("user", [textBlock("One more question, please. (second)")])));
        wroteAt = Date.now();
        break;
      }
    }
    // As the composer does: ask right after writing the message.
    const composer = await askWork(repo, session.url, opts).catch((e) => ({ error: e.message }));
    const result = await within(120_000, first, "askWork's burst").catch((e) => ({ error: e.message }));
    const sent = of("message").length;
    await sleep(8000); // the watch's own judgement after the end, and anything it asks
    const again = await askWork(repo, session.url, opts).catch((e) => ({ error: e.message }));
    await sleep(3000);
    const doc = session.doc();
    const assistantTexts = doc.turns.filter((t) => t.role === "assistant").map((t) => (t.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text).join(""));
    check(
      "message",
      "a message written while the burst streams is answered in the same burst (two requests, the second with it); askWork afterwards asks nothing more",
      !!wroteAt && result?.asked === true && result?.outcome === "idle" && sent === 2 && allText(of("message")[1]?.body).includes("(second)") && again?.asked === false && of("message").length === 2 && doc.burst === null,
      `first ask ${J(result)}; the composer's ask after the message ${J(composer)}; requests in the burst ${sent}, after ${of("message").length}; the second ${allText(of("message")[1]?.body).includes("(second)") ? "has" : "lacks"} the message; askWork again ${J(again)}; assistant replies ${J(assistantTexts)}; burst ${J(doc.burst)}`,
    );
    forget(session.url);

    // The same, but the page that wrote the message closes (forget) right after its ask.
    scripts.closed = (body) => (allText(body).includes("(closing)") ? { pieces: ["Answered ", "anyway."], everyMs: 200 } : { pieces: Array.from({ length: 10 }, (_, i) => `part${i} `), everyMs: 400 });
    const s2 = newSession("Tell me something long, then I leave. (closed)");
    await sleep(500);
    const first2 = askWork(repo, s2.url, opts).catch((e) => ({ error: e.message }));
    let wrote2 = null;
    let composer2 = null;
    for (const t0 = Date.now(); Date.now() - t0 < 90_000; await sleep(100)) {
      const reply = replyOf(s2.doc());
      if (reply.streaming && reply.text.split(" ").length > 3) {
        s2.change((d) => d.turns.push(makeTurn("user", [textBlock("A last question before I close the page. (closing)")])));
        wrote2 = Date.now();
        composer2 = await askWork(repo, s2.url, opts).catch((e) => ({ error: e.message }));
        forget(s2.url);
        break;
      }
    }
    // Followed by nobody's askWork now: only the queue's own watch, to see the task end.
    const ended2 = await within(120_000, new Promise((resolve) => {
      const stopWatching = watch(repo, queueUrl, workKey(s2.url), (view) => {
        if (["succeeded", "failed", "cancelled"].includes(view.state)) (stopWatching?.(), resolve(view.result ?? view.state));
      });
    }), "the burst whose asker closed").catch((e) => ({ error: e.message }));
    await sleep(15_000);
    const d2 = s2.doc();
    const last2 = d2.turns.at(-1);
    check(
      "closed",
      "a message written while the burst streams, by a page that asks and then closes, is answered (the burst answers what arrives while it runs)",
      !!wrote2 && of("closed").length === 2 && last2?.role === "assistant",
      `the closing page's ask ${J(composer2)}; the burst ended ${J(ended2)}; requests ${of("closed").length}; the session's last turn ${J({ role: last2?.role, text: (last2?.blocks ?? []).map((b) => b.text ?? b.type).join("") })} 15 s after the end; first ask ${J(await Promise.race([first2, sleep(10).then(() => "still waiting")]))}`,
    );
  }

  // ---- offline: the provider unreachable, then back.
  if (wants("offline")) {
    scripts.offline = () => ({ pieces: ["Back ", "again."], everyMs: 200 });
    await standDown();
    const session = newSession("Answer when the network is back. (offline)");
    const seen = [];
    session.on("change", ({ doc }) => seen.push(doc.reconnecting ?? null));
    const asked = ask(session);
    let reconnectingAt = null;
    for (const t0 = Date.now(); Date.now() - t0 < 60_000; await sleep(100)) {
      if (session.doc().reconnecting) {
        reconnectingAt = Date.now() - t0;
        break;
      }
    }
    const whileDown = J(session.doc().reconnecting ?? null);
    await sleep(8000);
    const stateWhileDown = asked.views.at(-1)?.state ?? null;
    await standUp();
    const result = await within(150_000, asked.result, "the burst after the network came back").catch((e) => ({ error: e.message }));
    const doc = session.doc();
    const errors = doc.turns.flatMap((t) => t.blocks ?? []).filter((b) => b.type === "notice" && b.kind === STOP.error);
    check(
      "offline",
      "the provider unreachable: the burst writes that it is reconnecting, the task stays running, and it carries on and ends idle when the provider is back",
      reconnectingAt !== null && stateWhileDown === "running" && result?.outcome === "idle" && replyOf(doc).text === "Back again." && doc.reconnecting == null && errors.length === 0,
      `reconnecting written ${reconnectingAt} ms after asking: ${whileDown.slice(0, 200)}; task state 8 s later ${stateWhileDown}; then ${J(result)}; reply ${J(replyOf(doc).text)}; reconnecting now ${J(doc.reconnecting ?? null)}; error notices ${errors.length}; runs ${J(runsOf(asked.views))}`,
    );
  }

  // ---- kill9: kill -9 of the host mid-reply.
  if (wants("kill9")) {
    let retaken = false;
    scripts.kill = () => (retaken ? { pieces: ["Answered ", "after ", "the ", "kill."], everyMs: 300 } : { pieces: Array.from({ length: 30 }, (_, i) => `bit${i} `), everyMs: 400 });
    const session = newSession("Say a long thing, then lose a host. (kill)");
    const asked = ask(session);
    let killed = null;
    let markedId = null;
    for (const t0 = Date.now(); Date.now() - t0 < 90_000; await sleep(100)) {
      const reply = replyOf(session.doc());
      const open = asked.views.at(-1)?.runs?.find((r) => !r.status);
      if (reply.streaming && reply.text.split(" ").length > 4 && open) {
        markedId = reply.id;
        killed = byPool(open.pool);
        break;
      }
    }
    let result = null;
    let tookMs = null;
    if (killed) {
      retaken = true;
      const at = Date.now();
      killed.child.kill("SIGKILL");
      result = await within(150_000, asked.result, "the burst after kill -9").catch((e) => ({ error: e.message }));
      tookMs = Date.now() - at;
    }
    const doc = session.doc();
    const finisher = byPool((asked.views.at(-1)?.runs ?? []).find((r) => r.status === "succeeded")?.pool)?.label ?? null;
    check(
      "kill9",
      "after kill -9 of the host running it mid-reply, the other retakes it, drops the marked reply and finishes",
      !!killed && result?.outcome === "idle" && finisher && finisher !== killed.label && !doc.turns.some((t) => t.id === markedId) && replyOf(doc).text === "Answered after the kill." && marksOf(doc) === 0 && doc.burst === null && doc.turns.filter((t) => t.role === "assistant").length === 1,
      `killed ${killed?.label ?? "none"}; ended ${tookMs} ms later: ${J(result)}; runs ${J(runsOf(asked.views))}; the marked reply ${doc.turns.some((t) => t.id === markedId) ? "still there" : "dropped"}; reply ${J(replyOf(doc).text)}; marks ${marksOf(doc)}; burst ${J(doc.burst)}; requests ${of("kill").length}`,
    );
  }

  // ---- Where the keys are, and what the sessions ever named.
  await sleep(1000);
  const tasks = [];
  for (const url of taskUrls) tasks.push({ url, doc: (await repo.find(url)).doc() });
  const queue = (await repo.find(queueUrl)).doc();
  const found = {
    sessions: sessions.filter((s) => KEYS.some((k) => everHeld(s.doc()).includes(k))).length,
    queue: KEYS.filter((k) => J(queue).includes(k)),
    results: tasks.filter((t) => KEYS.some((k) => J(t.doc?.runs ?? []).includes(k) || J(t.doc?.result ?? null).includes(k))).length,
    outsideInput: tasks.filter((t) => {
      const { input, ...rest } = t.doc ?? {};
      return KEYS.some((k) => J(rest).includes(k));
    }).length,
    hostLines: hosts.flatMap((h) => h.lines.filter((l) => KEYS.some((k) => l.includes(k))).map((l) => `${h.label}: ${l.slice(0, 160)}`)),
    authorization: requests.filter((r) => r.authorization && r.authorization !== `Bearer ${MODEL_KEY}`).length,
  };
  const inInput = tasks.filter((t) => t.doc?.input?.keys?.model === MODEL_KEY).length;
  const named = sessions.filter((s) => {
    const held = everHeld(s.doc());
    return held.includes(queueUrl.slice("automerge:".length)) || [...taskUrls].some((u) => held.includes(u.slice("automerge:".length)));
  }).length;
  check(
    "keys",
    "the made-up keys are in the tasks' inputs and nowhere else (sessions' histories, the queue, run records, results, what the hosts printed); no session ever named a task or the queue",
    inInput === tasks.length && tasks.length > 0 && found.sessions === 0 && found.queue.length === 0 && found.results === 0 && found.outsideInput === 0 && found.hostLines.length === 0 && found.authorization === 0 && named === 0,
    `${tasks.length} tasks, keys in ${inInput} inputs; found elsewhere ${J(found)}; sessions naming a task or the queue ${named} of ${sessions.length}`,
  );
  const problems = hosts.flatMap((h) => h.lines.filter((l) => /error|crash|threw|cannot import/i.test(l)).map((l) => `${h.label}: ${l.slice(0, 200)}`));
  console.error(`what the hosts said that looks like trouble: ${problems.length ? J(problems.slice(0, 12)) : "nothing"}`);
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
  for (const h of hosts) console.error(`host ${h.label}'s last lines: ${J(h.lines.slice(-8))}`);
}

for (const h of hosts) if (alive(h)) h.child.kill("SIGTERM");
for (const t0 = Date.now(); hosts.some(alive) && Date.now() - t0 < 12_000; ) await sleep(100);
if (up) await standDown();
try {
  await repo?.shutdown?.();
} catch {}
cleanup();
process.exit(failed ? 1 : 0);
