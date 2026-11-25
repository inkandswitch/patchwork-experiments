#!/usr/bin/env node
/**
 * Bring existing sessions and workflow plans up to the shape the agent now
 * reads, once.
 *
 *   node scripts/migrate.mjs [--dry] [--force] [--sync wss://…] automerge:<url> [more…]
 *
 * Each URL is an account, a folder, a session or a workflow plan. Point it at
 * an account document to reach everything the agent keeps for that account:
 *
 *   - the floating box's list of sessions, in the account's tool storage
 *     (ui/ambient.js);
 *   - from every session and plan found, the others they name: a plan's
 *     orchestrator and steps, a session's plan, its side threads and the
 *     documents it made;
 *   - what is filed under its root folder, every folder walked;
 *   - the session the sidebar keeps for a document, on the document itself
 *     (`@patchwork.agent`, ui/panel.js), for every document met on the way.
 *
 * It works in three passes:
 *
 *   find     Walk from the roots, sessions and plans first, then folders,
 *            then every other document. An account holds far more than fits
 *            in memory, and some of it is large enough to stall a connection
 *            to the sync server. So documents are read a few at a time, each
 *            few by a process of its own with a connection of its own, which
 *            is ended when it has answered or run out of time. What was not
 *            reached is tried again alone, with longer, and listed if it
 *            still cannot be read: a session kept on such a document is not
 *            migrated (the sidebar starts a new one there, ui/panel.js).
 *   change   Each session and plan that needs it, in one write. A plan whose
 *            research steps kept things gets a ledger document holding them,
 *            made before the plan is changed to name it.
 *   check    Read each one back, from a process of its own, and confirm it
 *            is in the current shape on the server.
 *
 * `--dry` stops after the first pass and says what the second would change.
 * Without `--force` nothing is changed while a session found has a runner on
 * it now.
 *
 * Delete this file, migrate-session.js and migrate-plan.js once it has been
 * run: the agent reads only the current shape (kernel/runner.js,
 * workflow/driver.js).
 */

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Repo, initSubduction, setSubductionLogLevel, generateAutomergeUrl } from "@automerge/automerge-repo"
import { migrateSession } from "./migrate-session.js"
import { migratePlan, ledgerFor } from "./migrate-plan.js"
import { SCHEMA_VERSION } from "../session/schema.js"
import { PLAN_VERSION } from "../workflow/plan.js"
import { LEDGER_TYPE } from "../kernel/kernel-repo.js"

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com"
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const roots = args.filter((arg) => arg.startsWith("automerge:"))
const SYNC = option("sync", process.env.PATCHWORK_SYNC ?? DEFAULT_SYNC)
const DRY = flag("dry")
const FORCE = flag("force")
/** How long a document may take to arrive before it is given up on, the first time and when tried again alone. */
const FIND_MS = Number(option("timeout", 20000))
const RETRY_MS = Number(option("retry-timeout", 90000))
/** How many documents one process reads. */
const BATCH = Number(option("batch", 6))
/** How long to stay connected after the last write, for the server to take it. */
const SETTLE_MS = Number(option("settle", 15000))
/** A lease stamped this recently has a runner on it now (kernel/runner.js beats every few seconds). */
const RUNNING_MS = 60000

if (!roots.length) {
  console.error("Usage: node scripts/migrate.mjs [--dry] [--force] [--sync wss://…] automerge:<account, folder, session or plan> [more…]")
  process.exit(2)
}

const typeOf = (doc) => doc?.["@patchwork"]?.type ?? null
const bare = (url) => String(url).split("#")[0]
const copy = (doc) => JSON.parse(JSON.stringify(doc, (_key, value) => (value instanceof Uint8Array ? null : value)))

async function connect() {
  await initSubduction()
  try {
    setSubductionLogLevel("error")
  } catch {
    /* older builds do not expose it */
  }
  return new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
}

async function open(repo, url, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms)
  })
  try {
    return await Promise.race([repo.find(url), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- what leads where

/** The order things are looked at in: what may need migrating, then what leads to more, then everything else. */
const SESSIONS = 0
const FOLDERS = 1
const DOCUMENTS = 2

/** The floating box's entry in an account's tool storage (ui/ambient.js STORAGE_TOOL_ID). */
const AMBIENT_STORAGE = "agent-ambient"

/** Every document `doc` leads to, as `[rank, url, name?]`. */
function links(doc) {
  const type = typeOf(doc)
  // The sidebar's session for this document, whatever the document is.
  const out = [[SESSIONS, doc?.["@patchwork"]?.agent]]
  if (type === "agent-session") {
    out.push([SESSIONS, doc.workflow?.planUrl], [SESSIONS, doc.workflow?.orchestratorUrl], [SESSIONS, doc.aside?.sessionUrl], [SESSIONS, doc.aside?.planUrl])
    for (const aside of doc.asides ?? []) out.push([SESSIONS, aside?.url ?? aside?.sessionUrl])
    for (const made of doc.made ?? []) {
      if (["agent-session", "agent-workflow"].includes(made?.kind)) out.push([SESSIONS, made.url])
      else if (made?.kind === "folder") out.push([FOLDERS, made.url])
    }
  } else if (type === "agent-workflow") {
    out.push([SESSIONS, doc.sessionUrl], [FOLDERS, doc.sourcesFolderUrl])
    for (const step of doc.steps ?? []) out.push([SESSIONS, step.sessionUrl], ...(step.previous ?? []).map((p) => [SESSIONS, p?.sessionUrl]))
  } else if (type === "account") {
    out.push([SESSIONS, doc.toolStorage?.[AMBIENT_STORAGE]], [FOLDERS, doc.rootFolderUrl])
  } else if (type === "patchwork:tool-storage") {
    out.push([SESSIONS, doc.sessionUrl], ...(Array.isArray(doc.sessions) ? doc.sessions : []).map((url) => [SESSIONS, url]))
  } else if (Array.isArray(doc?.docs)) {
    for (const entry of doc.docs) {
      const rank = ["agent-session", "agent-workflow"].includes(entry?.type) ? SESSIONS : entry?.type === "folder" ? FOLDERS : DOCUMENTS
      out.push([rank, entry?.url, entry?.name ?? "?"])
    }
  }
  return out.filter(([, url]) => typeof url === "string" && url.startsWith("automerge:")).map(([rank, url, name]) => [rank, bare(url), name ?? null])
}

/** What the walk needs to know of one document. */
function describe(url, doc) {
  const type = typeOf(doc)
  const said = { url, ok: true, type, links: links(doc) }
  if (type === "agent-session") {
    said.kind = "session"
    said.title = doc.title ?? "(untitled)"
    said.migrate = migrateSession(copy(doc))
    said.running = !!doc.lease && Date.now() - Number(doc.lease.at ?? 0) < RUNNING_MS
  } else if (type === "agent-workflow") {
    const ledger = ledgerFor(copy(doc))
    said.kind = "plan"
    said.title = doc.title ?? "(untitled plan)"
    said.migrate = migratePlan(copy(doc), { ledgerUrl: ledger ? generateAutomergeUrl() : null })
    said.kept = ledger ? Object.keys(ledger.sources).length : null
  } else if (Array.isArray(doc?.docs)) said.kind = "folder"
  else if (type === LEDGER_TYPE) said.kind = "ledger"
  return said
}

// ---------------------------------------------------------------- one process, a few documents

// `--read <ms> url…`: read each document, say what it is on a line of its
// own as soon as it is known, and end. The parent ends it if it does not.
if (flag("read")) {
  const ms = Number(option("read", FIND_MS))
  const repo = await connect()
  const say = (line) => new Promise((resolve) => process.stdout.write(JSON.stringify(line) + "\n", resolve))
  await Promise.all(
    roots.map(async (url) => {
      try {
        const doc = (await open(repo, url, ms)).doc()
        await say({ ...describe(url, doc), schemaVersion: doc?.schemaVersion ?? null, ledgerUrl: doc?.ledgerUrl ?? null })
      } catch (err) {
        await say({ url, ok: false, why: /timed out/.test(String(err?.message)) ? "timed out" : "unavailable" })
      }
    })
  )
  process.exit(0)
}

/** Read `urls` in a process of its own; resolves to what it said of each, with those it never answered for marked so. */
function read(urls, ms) {
  if (!urls.length) return Promise.resolve([])
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--read", String(ms), "--sync", SYNC, ...urls], { stdio: ["ignore", "pipe", "ignore"] })
    const answers = new Map()
    let buffered = ""
    child.stdout.on("data", (chunk) => {
      buffered += chunk
      for (let at; (at = buffered.indexOf("\n")) >= 0; buffered = buffered.slice(at + 1)) {
        try {
          const said = JSON.parse(buffered.slice(0, at))
          answers.set(said.url, said)
        } catch {
          /* not one of ours */
        }
      }
    })
    const timer = setTimeout(() => child.kill("SIGKILL"), ms + 30000)
    child.on("close", () => {
      clearTimeout(timer)
      resolve(urls.map((url) => answers.get(url) ?? { url, ok: false, why: "timed out" }))
    })
  })
}

// ---------------------------------------------------------------- find

const seen = new Set()
const queue = [[], [], []]
const paths = new Map()
const found = []
let unreached = []
const counts = { folders: 0, documents: 0 }

function enqueue(rank, url, path) {
  if (seen.has(url)) return
  seen.add(url)
  paths.set(url, path)
  queue[rank].push(url)
}

function take(said) {
  if (!said.ok) return unreached.push({ url: said.url, why: said.why })
  if (said.kind === "session" || said.kind === "plan") found.push(said)
  else if (said.kind === "folder") counts.folders++
  else counts.documents++
  const from = paths.get(said.url)
  for (const [rank, url, name] of said.links) enqueue(rank, url, name ? `${from}/${name}` : `${from} → ${said.type ?? "document"}`)
}

/** Work through the queue in rank order, a few documents to a process. */
async function drain(ms, size) {
  for (;;) {
    const rank = queue.findIndex((q) => q.length)
    if (rank < 0) return
    for (const said of await read(queue[rank].splice(0, size), ms)) take(said)
    if (process.stderr.isTTY) process.stderr.write(`\r  ${seen.size - queue.flat().length} read, ${queue.flat().length} to go, ${found.length} sessions and plans, ${unreached.length} not reached   `)
  }
}

const started = Date.now()
for (const root of roots) enqueue(SESSIONS, bare(root), "root")
await drain(FIND_MS, BATCH)

// What was not reached is tried again, each alone and with longer to arrive;
// and what that leads to is walked as the rest was.
const again = unreached
unreached = []
for (const item of again) {
  for (const said of await read([item.url], RETRY_MS)) take(said)
  await drain(FIND_MS, BATCH)
}
if (process.stderr.isTTY) process.stderr.write("\n")

const sessions = found.filter((f) => f.kind === "session")
const plans = found.filter((f) => f.kind === "plan")
const toMigrate = found.filter((f) => f.migrate)
const running = sessions.filter((f) => f.running)
for (const item of toMigrate) console.log(`  ${DRY ? "would migrate" : "to migrate   "} ${item.kind.padEnd(7)} ${item.url}  ${item.title}${item.kept != null ? `, with a ledger of ${item.kept} kept` : ""}`)
for (const item of running) console.log(`  running now   session ${item.url}  ${item.title}`)
for (const item of unreached) console.log(`  not reached   ${item.url}  (${paths.get(item.url)}: ${item.why})`)
const late = unreached.filter((u) => u.why === "timed out").length
console.log(
  `\n${sessions.length} sessions (${sessions.filter((f) => f.migrate).length} to migrate, ${sessions.filter((f) => !f.migrate).length} already current, ${running.length} running now), ` +
    `${plans.length} plans (${plans.filter((f) => f.migrate).length} to migrate, ${plans.filter((f) => f.kept != null).length} with a ledger), ` +
    `${counts.folders} folders, ${counts.documents} other documents, ` +
    `${unreached.length} not reached (${late} too slow to arrive, ${unreached.length - late} not on the server), in ${Math.round((Date.now() - started) / 1000)} s.`
)

if (DRY || !toMigrate.length) process.exit(unreached.length ? 1 : 0)
if (running.length && !FORCE) {
  console.log(`\nNothing was changed: ${running.length} session${running.length === 1 ? " has" : "s have"} a runner on ${running.length === 1 ? "it" : "them"} now. Run again when ${running.length === 1 ? "it has" : "they have"} finished, or pass --force.`)
  process.exit(3)
}

// ---------------------------------------------------------------- change

const repo = await connect()
const changed = []
for (const item of toMigrate) {
  try {
    const handle = await open(repo, item.url, RETRY_MS)
    if (item.kind === "session") handle.change((d) => migrateSession(d))
    else {
      const ledger = ledgerFor(copy(handle.doc()))
      const made = ledger ? repo.create(ledger) : null
      handle.change((d) => migratePlan(d, { ledgerUrl: made?.url ?? null }))
      item.ledgerUrl = made?.url ?? null
    }
    changed.push(item)
    console.log(`  migrated      ${item.kind.padEnd(7)} ${item.url}  ${item.title}`)
  } catch (err) {
    console.log(`  NOT migrated  ${item.kind.padEnd(7)} ${item.url}  ${item.title}  (${err?.message ?? err})`)
  }
}
console.log(`\nWaiting ${Math.round(SETTLE_MS / 1000)} s for the sync server to take the changes…`)
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

// ---------------------------------------------------------------- check

let confirmed = 0
for (let at = 0; at < changed.length; at += BATCH) {
  const batch = changed.slice(at, at + BATCH)
  const read1 = await read(batch.map((item) => item.url), RETRY_MS)
  const ledgers = new Map((await read(batch.map((item) => item.ledgerUrl).filter(Boolean), RETRY_MS)).map((said) => [said.url, said]))
  for (const [i, item] of batch.entries()) {
    const said = read1[i]
    let ok = said.ok && said.migrate === false && said.schemaVersion === (item.kind === "session" ? SCHEMA_VERSION : PLAN_VERSION)
    if (ok && item.ledgerUrl) ok = said.ledgerUrl === item.ledgerUrl && ledgers.get(item.ledgerUrl)?.kind === "ledger"
    if (ok) confirmed++
    else console.log(`  NOT confirmed ${item.kind.padEnd(7)} ${item.url}  ${item.title}`)
  }
}
console.log(`${changed.length} changed, ${confirmed} read back in the current shape from the server; ${toMigrate.length - changed.length} could not be changed.`)
process.exit(confirmed === toMigrate.length && !unreached.length ? 0 : 1)
