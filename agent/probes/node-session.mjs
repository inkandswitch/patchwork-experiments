/**
 * Prove the whole harness runs outside a browser.
 *
 * Creates a subject document and an agent session from node, asks the agent to
 * do something, runs the loop to completion, and prints what happened. If this
 * works, a session is durable: it does not need a tab open, and the same
 * documents are visible to the browser through the sync server.
 *
 * Usage: OPENROUTER_API_KEY=… node probes/node-session.mjs ["a prompt"]
 */

import { Repo, initSubduction, setSubductionLogLevel } from "@automerge/automerge-repo"
import { splice } from "@automerge/automerge/slim"

import { handleStore } from "../kernel/store.js"
import { SessionRunner } from "../kernel/runner.js"
import { AGENT } from "../assembly/agent.js"
import { getProvider } from "../providers/index.js"
import { initSession, STATUS } from "../session/schema.js"
import { say, decide } from "../kernel/loop.js"
import { callsAwaitingApproval } from "../session/calls.js"
import { nodeFetch } from "../net/node-fetch.mjs"

const SYNC = process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"
const KEY = process.env.OPENROUTER_API_KEY
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-4.5"
const PROMPT =
  process.argv[2] ??
  "Rename this document's title to 'Braised Leeks' and add 'butter' to its items, then tell me what you changed."

if (!KEY) {
  console.error("Set OPENROUTER_API_KEY.")
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...parts) => console.log(...parts)

await initSubduction()
try {
  setSubductionLogLevel("error")
} catch {
  /* fine */
}

const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
log(`connected to ${SYNC}`)

// ---- a document to work on, created from node ------------------------------
const subject = await repo.create2()
subject.change((d) => {
  d.title = "Untitled"
  d.items = ["leeks"]
  d["@patchwork"] = { type: "agent-node-probe" }
})
log(`subject: ${subject.url}`)

// ---- a session, created from node ------------------------------------------
const session = await repo.create2()
session.change((d) => {
  initSession(d, { title: "Node session", subject: subject.url })
  d.config.model = MODEL
  d["@patchwork"] = { type: "agent-session" }
})
log(`session: ${session.url}`)

const store = handleStore(session, splice)
say(store, PROMPT)

// ---- run it ----------------------------------------------------------------
const started = Date.now()
const trail = []

const runner = new SessionRunner({
  ...AGENT,
  store,
  runnerUrl: `node-probe-${process.pid}`,
  ctx: {
    repo, splice, subject: subject.url, sessionUrl: session.url, direct: true,
    fetchImpl: nodeFetch({ sync: SYNC }),
  },
  getProvider: async () => getProvider("openrouter"),
  getKey: () => KEY,
  canRun: (where) => where === "worker",
  onEvent: (event) => {
    const at = Date.now() - started
    if (event.type === "call-start") trail.push(`${at}ms  → ${event.tool}(${JSON.stringify(event.input).slice(0, 120)})`)
    else if (event.type === "call-end") trail.push(`${at}ms  ← ${event.summary}${event.isError ? " [error]" : ""}`)
    else if (event.type === "finish") trail.push(`${at}ms  finish: ${event.outcome}${event.reason ? ` (${event.reason})` : ""}`)
    else if (event.type === "error") trail.push(`${at}ms  error: ${event.error}`)
  },
})

runner.start()

// Approve whatever it asks for, up to a few times — this probe is checking the
// machinery, not the approval UI, which the browser probe covers.
let approvals = 0
for (let i = 0; i < 200; i++) {
  const doc = store.doc()

  if (doc.status === STATUS.awaitingApproval && approvals < 8) {
    for (const call of callsAwaitingApproval(doc)) {
      trail.push(`${Date.now() - started}ms  approving ${call.tool}`)
      decide(store, call.id, "session", subject.url)
      approvals++
    }
    runner.tick()
  }

  const last = doc.turns.at(-1)
  const settled =
    doc.status === STATUS.idle && doc.turns.length > 1 && last?.role === "assistant" && !runner.running
  if (settled || doc.status === STATUS.error) break

  await sleep(250)
}

runner.stop()

// ---- what happened ---------------------------------------------------------
const doc = store.doc()
const blocks = doc.turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))

log("\n=== trajectory ===")
for (const line of trail) log(`  ${line}`)

log("\n=== assistant said ===")
log(blocks.filter((b) => b.type === "text" && b.role === "assistant").map((b) => b.text).join("\n"))

log("\n=== subject document afterwards ===")
log(JSON.stringify(subject.doc(), null, 2))

log("\n=== usage ===")
log(JSON.stringify(doc.usage))

const calls = blocks.filter((b) => b.type === "call")
const errors = blocks.filter((b) => b.type === "result" && b.isError)
const checks = [
  ["the session ran outside a browser", doc.turns.length > 1],
  ["it called tools", calls.length > 0],
  ["no tool errored", errors.length === 0],
  ["the document was changed", subject.doc().title === "Braised Leeks"],
  ["it finished idle", doc.status === STATUS.idle],
]
log("\n=== verdict ===")
for (const [label, ok] of checks) log(`${ok ? "PASS" : "FAIL"}  ${label}`)
log(`\nOpen it in a browser: ${session.url}`)

// Give sync a moment to flush before tearing the socket down, so the documents
// are actually on the server when this exits.
await sleep(2000)
try {
  await repo.shutdown?.()
} catch {
  /* best effort */
}
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
