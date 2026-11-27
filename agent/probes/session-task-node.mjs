// The session task (runners/session-task.js) on two Node hosts, through the
// real sync server: steps 2b and 3b of notes/SPEC-AGENT.md.
//
//   (after `pnpm build:node` in tasks/) node probes/session-task-node.mjs [--sync wss://…] [--verbose]
//
// Two hosts (tasks/dist-node/host.mjs, real processes with fresh data
// directories) serve one queue the first makes (`--new-queue`), each with this
// directory as its copy of a made-up package (`--local`). The model is a
// stand-in (probes/stand-in-provider.mjs) on this machine, reached through the
// task input's `providerUrl`, with a made-up key. This process is the asker:
// a Repo of its own makes the account's root folder with a note in it and
// each session, and asks a burst with the tasks client's run(), as a page's
// askWork would, under `agent:<session>`, the input in askWork's order.
//
// Checks, one line each, with what was seen:
//   1 the module imports on a host, and the burst answers: { outcome, heads, own }
//   2 the notes are read through the run's own Repo (the stand-in's system prompt has the note)
//   3 the reply's text grows by one splice per flush (the session's history)
//   4 the keys are in the task's input and nowhere else; the session never holds the task's url
//   5 SIGTERM of the host running a burst mid-reply: the other retakes, drops the marked reply, finishes
//   6 a stop written into the session by the asker ends the run within a sync delay
//
// Every host, the stand-in and the Repo are stopped at the end, pass or fail;
// the process exits 1 if any check failed.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Repo, initSubduction, stringifyAutomergeUrl } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge";
import { initSession } from "../session/schema.js";
import { makeTurn, textBlock } from "../session/blocks.js";
import { stopSession } from "../session/recovery.js";
import { STOP } from "../session/status.js";
import { noteWrite } from "../knowledge/notes.js";
import { workKey } from "../runners/ask.js";
import { standIn } from "./stand-in-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, "..");
const HOST = join(AGENT, "../tasks/dist-node/host.mjs");
// The tasks package's Node build of its client: a probe is no pool, and has no registry.
const { run } = await import(pathToFileURL(join(dirname(HOST), "task-client.mjs")).href);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SYNC = arg("--sync") ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const VERBOSE = process.argv.includes("--verbose");
const SCRATCH = arg("--scratch") ?? process.env.PROBE_SCRATCH ?? tmpdir();
// Made up, from fixed bytes: the package the hosts run from this directory.
const PKG = stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(7) });
const IMPORT = `/${encodeURIComponent(PKG)}/runners/session-task.js`;
const MODEL_KEY = "made-up-model-key-0f3a9c";
const SEARCH_KEY = "made-up-search-key-7b21de";

const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing after ${ms / 1000} s`)), ms))]);
let failed = false;
const check = (n, name, ok, saw) => {
  if (!ok) failed = true;
  console.error(`${ok ? "ok  " : "FAIL"} ${n}. ${name}: ${typeof saw === "string" ? saw : J(saw)}`);
};

// What the stand-in says, by the session's first words.
const SCRIPTS = {
  plain: { pieces: ["The ", "sloop ", "is ", "called ", "Kestrel, ", "as ", "your ", "note ", "says."], everyMs: 400 },
  long: { pieces: Array.from({ length: 24 }, (_, i) => `piece${i} `), everyMs: 400 },
  again: { pieces: ["Answered ", "again ", "from ", "the ", "start."], everyMs: 300 },
};
const lastUser = (body) => {
  const user = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user");
  return typeof user?.content === "string" ? user.content : J(user?.content ?? "");
};
let retaken = false;
const stand = await standIn((body) => {
  const said = lastUser(body);
  if (/\blong\b/.test(said)) return retaken ? SCRIPTS.again : SCRIPTS.long;
  return SCRIPTS.plain;
});

mkdirSync(SCRATCH, { recursive: true });
const dirs = [];
const hosts = [];
const cleanup = () => {
  for (const h of hosts) if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill("SIGKILL");
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};
process.on("exit", cleanup);
setTimeout(() => (console.error("TIMEOUT"), cleanup(), process.exit(2)), 6 * 60_000).unref();

function startHost(label, queueArgs) {
  const dataDir = mkdtempSync(join(SCRATCH, `host-${label}-`));
  dirs.push(dataDir);
  const child = spawn(process.execPath, [HOST, ...queueArgs, "--local", `${PKG}=${AGENT}`, "--data-dir", dataDir, "--workers", "1", "--name", `agent-probe-${label}`, "--sync", SYNC, "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
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

/** The ops of every change of a document, decoded, as one string: what it ever held. */
const everHeld = (doc) => J(A.getAllChanges(doc).map((c) => A.decodeChange(c).ops));

/** How the reply's text was written, from the session's history: each change's appends to it. */
function appendsTo(doc, turn, block, pieces) {
  const textId = A.getObjectId(doc.turns[turn].blocks[block], "text");
  const changes = A.getAllChanges(doc).map(A.decodeChange);
  let after = "_head";
  const each = [];
  let bad = null;
  for (const change of changes) {
    const ops = change.ops.map((op, i) => ({ op, i })).filter(({ op }) => op.obj === textId);
    if (!ops.length) continue;
    let inserted = "";
    for (const { op, i } of ops) {
      if (!(op.action === "set" && op.insert === true && op.elemId === after && op.pred.length === 0)) {
        bad ??= { action: op.action, insert: op.insert ?? null, elemId: op.elemId ?? null, expected: after };
        continue;
      }
      inserted += op.value;
      after = `${change.startOp + i}@${change.actor}`;
    }
    each.push(inserted);
  }
  // each change one or more whole pieces, in order
  let k = 0;
  const whole = each.every((text) => {
    let rest = text;
    if (!rest) return false;
    while (rest && k < pieces.length && rest.startsWith(pieces[k])) rest = rest.slice(pieces[k++].length);
    return rest === "";
  });
  return { changes: each.length, onePiece: each.filter((t) => pieces.includes(t)).length, whole: whole && k === pieces.length, bad };
}

/** Where the reply's text is: the last assistant turn's last text block. */
function replyOf(doc) {
  const turn = (doc?.turns ?? []).findLastIndex((t) => t.role === "assistant");
  const blocks = doc?.turns?.[turn]?.blocks ?? [];
  const block = blocks.findLastIndex((b) => b.type === "text");
  return { turn, block, id: doc?.turns?.[turn]?.id ?? null, text: blocks[block]?.text ?? "", streaming: doc?.turns?.[turn]?.streaming ?? null };
}

let repo;
try {
  await initSubduction();
  repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });

  const A1 = startHost("a", ["--new-queue", "agent session-task probe"]);
  await untilSaid(A1, (h) => h.pool && h.queue);
  const queueUrl = A1.queue;
  const B1 = startHost("b", ["--queue", queueUrl]);
  await untilSaid(B1, (h) => h.pool);
  const byPool = (pool) => hosts.find((h) => h.pool === pool) ?? null;

  // The account's root folder, with the note the run must read through its own Repo.
  const root = repo.create({ title: "Root", docs: [], "@patchwork": { type: "folder" } });
  await noteWrite.execute({ name: "Boat names", content: "# Boat names\nThe sloop is called Kestrel.\n" }, { repo, rootFolderUrl: root.url, splice: A.splice });

  const newSession = (words) => {
    const handle = repo.create();
    handle.change((d) => {
      initSession(d, {});
      d.config.model = "made-up/model";
      d.turns.push(makeTurn("user", [textBlock(words)]));
      d.burst = null;
    });
    return handle;
  };
  const inputOf = (session) => ({
    session: session.url,
    heads: [...session.heads()],
    account: { rootFolderUrl: root.url, sensitiveDocs: [] },
    catalogue: { tools: [], skills: [] },
    providerUrl: stand.url,
    keys: { model: MODEL_KEY, search: SEARCH_KEY, relay: null },
  });
  const ask = (session, onView) => {
    const views = [];
    const result = run(repo, queueUrl, { importUrl: IMPORT, input: inputOf(session), key: workKey(session.url) }, (view) => {
      views.push(view);
      onView?.(view);
    });
    return { result, views };
  };
  await sleep(3_000); // both hosts listening past LISTEN_MS

  // 1-4. One burst.
  {
    const session = newSession("What is the sloop called? (plain)");
    const seen = [];
    session.on("change", ({ doc }) => seen.push(replyOf(doc).text));
    const t0 = Date.now();
    const asked = ask(session);
    let result;
    try {
      result = await within(120_000, asked.result, "the first burst");
    } catch (error) {
      result = { error: String(error?.message ?? error) };
    }
    const last = asked.views.at(-1);
    const taskUrl = last?.taskUrl ?? null;
    const ranOn = byPool(last?.runs?.find((r) => r.status === "succeeded")?.pool)?.label ?? null;
    const requests = stand.requests.filter((r) => /plain/.test(lastUser(r.body)));
    check(
      1,
      "the module imports on a host, and the burst answers { outcome, heads, own }",
      !result?.error && J(Object.keys(result ?? {}).sort()) === J(["heads", "outcome", "own"]) && result.outcome === "idle" && Array.isArray(result.heads) && Array.isArray(result.own),
      `in ${Date.now() - t0} ms on host ${ranOn}: ${J(result)}; runs ${J(last?.runs?.map((r) => r.status ?? "open"))}; its log ${J(last?.logs?.map((l) => l.message))}`,
    );
    const system = J(requests[0]?.body?.messages?.[0] ?? null);
    check(
      2,
      "the notes are read through the run's own Repo: the system prompt it sent names the note made by this asker",
      requests.length === 1 && system.includes("The sloop is called Kestrel."),
      `${requests.length} request(s) to the stand-in; the system prompt ${system.includes("Agent notes") ? "has" : "lacks"} the notes section and ${system.includes("Kestrel") ? "has" : "lacks"} the note`,
    );
    const doc = session.doc();
    const reply = replyOf(doc);
    const how = reply.turn >= 0 ? appendsTo(doc, reply.turn, reply.block, SCRIPTS.plain.pieces) : null;
    const lengths = [...new Set(seen.map((t) => t.length))].filter((n) => n > 0);
    check(
      3,
      "the reply's text grows by one splice per flush: every change to it appends whole pieces at the end, and the asker saw it grow",
      reply.text === SCRIPTS.plain.pieces.join("") && how?.whole && !how.bad && how.changes >= SCRIPTS.plain.pieces.length - 2 && lengths.length >= 3,
      `text ${J(reply.text)}; ${how?.changes} changes to it for ${SCRIPTS.plain.pieces.length} pieces (${how?.onePiece} of one piece each), every one appends whole pieces: ${how?.whole}${how?.bad ? `, first not an append: ${J(how.bad)}` : ""}; lengths seen on the way ${J(lengths)}`,
    );
    const task = taskUrl ? (await repo.find(taskUrl)).doc() : null;
    const queue = (await repo.find(queueUrl)).doc();
    const held = everHeld(doc);
    const taskId = taskUrl?.slice("automerge:".length) ?? "(no task)";
    const where = {
      session: [MODEL_KEY, SEARCH_KEY].filter((k) => held.includes(k)),
      queue: [MODEL_KEY, SEARCH_KEY].filter((k) => J(queue).includes(k)),
      result: [MODEL_KEY, SEARCH_KEY].filter((k) => J(result).includes(k)),
      logs: [MODEL_KEY, SEARCH_KEY].filter((k) => J(task?.runs ?? []).includes(k)),
      notes: [MODEL_KEY, SEARCH_KEY].filter((k) => everHeld(root.doc()).includes(k)),
    };
    const sentAs = requests.map((r) => r.authorization);
    check(
      4,
      "the keys are in the task's input and nowhere else, the model's sent only as its Authorization; the session never holds the task's url or the queue's",
      task?.input?.keys?.model === MODEL_KEY && task?.input?.keys?.search === SEARCH_KEY && Object.values(where).every((w) => w.length === 0) && sentAs.every((a) => a === `Bearer ${MODEL_KEY}`) && !held.includes(taskId) && !held.includes(queueUrl.slice("automerge:".length)),
      `input keys ${task?.input?.keys ? "present" : "absent"}; the input's fields as the task's document orders them ${J(Object.keys(task?.input ?? {}))} (asked as ${J(Object.keys(inputOf(session)))}: an Automerge map keeps no order of its own); found elsewhere ${J(where)}; sent as ${J(sentAs.map((a) => a?.replace(MODEL_KEY, "<key>")))}; the session ever held the task's id ${held.includes(taskId)}, the queue's ${held.includes(queueUrl.slice("automerge:".length))}`,
    );
  }

  // 5. SIGTERM of the host running a burst, mid-reply.
  {
    const session = newSession("Say a long thing. (long)");
    let killed = null;
    let markedId = null;
    let killedPool = null;
    const asked = ask(session);
    // Wait until the reply has a few pieces, and see which host has it.
    for (const t0 = Date.now(); Date.now() - t0 < 90_000; await sleep(100)) {
      const reply = replyOf(session.doc());
      const open = asked.views.at(-1)?.runs?.find((r) => !r.status);
      if (reply.streaming && reply.text.split(" ").length > 4 && open) {
        markedId = reply.id;
        killedPool = open.pool;
        killed = byPool(open.pool);
        break;
      }
    }
    let result;
    let tookMs = null;
    if (killed) {
      retaken = true;
      const at = Date.now();
      killed.child.kill("SIGTERM");
      try {
        result = await within(120_000, asked.result, "the retaken burst");
      } catch (error) {
        result = { error: String(error?.message ?? error) };
      }
      tookMs = Date.now() - at;
    }
    const doc = session.doc();
    const reply = replyOf(doc);
    const runs = asked.views.at(-1)?.runs ?? [];
    const finisher = byPool(runs.find((r) => r.status === "succeeded")?.pool)?.label ?? null;
    const marks = (doc.turns ?? []).filter((t) => t.streaming).length;
    check(
      5,
      "after SIGTERM of the host running it mid-reply, the other host retakes it, drops the marked reply and finishes",
      !!killed && result?.outcome === "idle" && runs.map((r) => r.status).join() === "lost,succeeded" && finisher && finisher !== killed.label && !doc.turns.some((t) => t.id === markedId) && reply.text === SCRIPTS.again.pieces.join("") && marks === 0 && doc.burst === null && doc.turns.filter((t) => t.role === "assistant").length === 1,
      `killed host ${killed?.label ?? "none"} (pool ${killedPool?.slice(0, 8) ?? "?"}) mid-reply; ended in ${tookMs} ms: ${J(result)}; runs ${J(runs.map((r) => `${byPool(r.pool)?.label ?? "?"}:${r.status ?? "open"}`))}; the marked reply ${doc.turns.some((t) => t.id === markedId) ? "still there" : "dropped"}; the reply now ${J(reply.text)}; marks left ${marks}; burst ${J(doc.burst)}; host ${killed?.label} exited ${killed?.child.exitCode ?? killed?.child.signalCode}`,
    );
  }

  // 6. A stop written into the session by the asker.
  {
    const session = newSession("Say a long thing, then be stopped. (long)");
    retaken = false;
    const asked = ask(session);
    let stoppedAt = null;
    let piecesAtStop = null;
    let replyId = null;
    for (const t0 = Date.now(); Date.now() - t0 < 90_000; await sleep(100)) {
      const reply = replyOf(session.doc());
      if (reply.streaming && reply.text.split(" ").length > 3) {
        piecesAtStop = reply.text.split(" ").length - 1;
        replyId = reply.id;
        session.change((d) => stopSession(d, STOP.stopped, null, null));
        stoppedAt = Date.now();
        break;
      }
    }
    let lastGrowth = null;
    const textOf = (doc) => (doc.turns.find((t) => t.id === replyId)?.blocks ?? []).map((b) => b.text ?? "").join("");
    let length = textOf(session.doc()).length;
    session.on("change", ({ doc }) => {
      const now = textOf(doc).length;
      if (now !== length) (length = now), (lastGrowth = Date.now());
    });
    let result;
    let endedMs = null;
    try {
      result = await within(60_000, asked.result, "the stopped burst");
      endedMs = Date.now() - stoppedAt;
    } catch (error) {
      result = { error: String(error?.message ?? error) };
    }
    const request = stand.requests.filter((r) => /be stopped/.test(lastUser(r.body))).at(-1);
    const doc = session.doc();
    const reply = { streaming: (doc.turns ?? []).find((t) => t.streaming)?.streaming ?? null };
    check(
      6,
      "a stop written into the session by the asker ends the run within a sync delay: the model's stream is dropped and the task returns 'stopped'",
      !!stoppedAt && result?.outcome === "stopped" && endedMs !== null && endedMs < 10_000 && request?.aborted === true && !reply.streaming && doc.burst === null,
      `stopped after ${piecesAtStop} pieces had arrived; the task ended ${endedMs} ms later: ${J(result)}; the text last grew ${lastGrowth === null ? "never after the stop" : `${lastGrowth - stoppedAt} ms after it`}; the stand-in's stream ${request?.aborted ? `dropped after ${request.sent} of ${SCRIPTS.long.pieces.length} pieces` : "not dropped"}; mark ${J(reply.streaming)}; burst ${J(doc.burst)}`,
    );
  }

  const problems = hosts.flatMap((h) => h.lines.filter((l) => /error|crash|threw|cannot import/i.test(l)).map((l) => `${h.label}: ${l}`));
  console.error(`what the hosts said that looks like trouble: ${problems.length ? J(problems.slice(0, 8)) : "nothing"}`);
} catch (error) {
  console.error("probe stopped:", error?.stack ?? error);
  failed = true;
  for (const h of hosts) console.error(`host ${h.label}'s last lines: ${J(h.lines.slice(-8))}`);
}

for (const h of hosts) if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill("SIGTERM");
for (const t0 = Date.now(); hosts.some((h) => h.child.exitCode === null && h.child.signalCode === null) && Date.now() - t0 < 12_000; ) await sleep(100);
await stand.close();
try {
  await repo?.shutdown?.();
} catch {}
cleanup();
process.exit(failed ? 1 : 0);
