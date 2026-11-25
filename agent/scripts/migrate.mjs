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
 * It works in three passes, each on a connection of its own:
 *
 *   find     Walk from the roots, sessions and plans first, then folders,
 *            then every other document. An account holds far more than fits
 *            in memory and some of it is very large, so a document is let go
 *            as soon as it has been looked at, one that does not arrive in
 *            time is given up on, and a connection that stops answering is
 *            replaced. What was not reached is tried again at the end, and
 *            listed if it still cannot be: a session kept on such a document
 *            is not migrated.
 *   change   Each session and plan that needs it, in one write. A plan whose
 *            research steps kept things gets a ledger document holding them,
 *            made before the plan is changed to name it.
 *   check    Read each one back and confirm it is in the current shape.
 *
 * `--dry` stops after the first pass and says what the second would change.
 * Without `--force` nothing is changed while a session found has a runner on
 * it now.
 *
 * Delete this file, migrate-session.js and migrate-plan.js once it has been
 * run: the agent reads only the current shape (kernel/runner.js,
 * workflow/driver.js).
 */

import { Repo, initSubduction, setSubductionLogLevel, generateAutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo"
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
/** How long a document may take to arrive before it is given up on, the first time and when tried again. */
const FIND_MS = Number(option("timeout", 20000))
const RETRY_MS = Number(option("retry-timeout", 60000))
/** How long to stay connected after the last write, for the server to take it. */
const SETTLE_MS = Number(option("settle", 15000))
/** A lease stamped this recently has a runner on it now (kernel/runner.js beats every few seconds). */
const RUNNING_MS = 60000

if (!roots.length) {
  console.error("Usage: node scripts/migrate.mjs [--dry] [--force] [--sync wss://…] automerge:<account, folder, session or plan> [more…]")
  process.exit(2)
}

await initSubduction()
try {
  setSubductionLogLevel("error")
} catch {
  /* older builds do not expose it */
}

// ---------------------------------------------------------------- the server

const connect = () => new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
let repo = connect()

/** A new connection in place of this one. */
async function reconnect() {
  try {
    await repo.shutdown()
  } catch {
    /* it had stopped answering; that is why it is being replaced */
  }
  repo = connect()
}

async function open(url, ms) {
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

/** Let a document go, which also stops a load that was given up on. */
async function release(url) {
  try {
    await repo.removeFromCache(parseAutomergeUrl(url).documentId)
  } catch {
    /* not held */
  }
}

// ---------------------------------------------------------------- what leads where

const typeOf = (doc) => doc?.["@patchwork"]?.type ?? null
const bare = (url) => String(url).split("#")[0]
const copy = (doc) => JSON.parse(JSON.stringify(doc, (_key, value) => (value instanceof Uint8Array ? null : value)))

/** The order things are looked at in: what may need migrating, then what leads to more, then everything else. */
const SESSIONS = 0
const FOLDERS = 1
const DOCUMENTS = 2

/** The floating box's entry in an account's tool storage (ui/ambient.js STORAGE_TOOL_ID). */
const AMBIENT_STORAGE = "agent-ambient"

/** Every document `doc` leads to, as `[rank, url]`. */
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
      out.push([rank, entry?.url, entry?.name])
    }
  }
  return out.filter(([, url]) => typeof url === "string" && url.startsWith("automerge:"))
}

// ---------------------------------------------------------------- find

const seen = new Set()
const queue = [[], [], []]
const found = []
let unreached = []
const counts = { folders: 0, documents: 0 }

function enqueue(rank, url, path) {
  const key = bare(url)
  if (seen.has(key)) return
  seen.add(key)
  queue[rank].push({ url: key, path })
}

/** Look at one document: note it if it is a session or a plan, and queue what it leads to. Throws when it cannot be read. */
async function look(item, ms) {
  const doc = (await open(item.url, ms)).doc()
  const type = typeOf(doc)
  if (type === "agent-session") {
    const lease = doc.lease
    found.push({
      url: item.url,
      kind: "session",
      title: doc.title ?? "(untitled)",
      migrate: migrateSession(copy(doc)),
      running: !!lease && Date.now() - Number(lease.at ?? 0) < RUNNING_MS,
    })
  } else if (type === "agent-workflow") {
    const ledger = ledgerFor(copy(doc))
    found.push({
      url: item.url,
      kind: "plan",
      title: doc.title ?? "(untitled plan)",
      migrate: migratePlan(copy(doc), { ledgerUrl: ledger ? generateAutomergeUrl() : null }),
      kept: ledger ? Object.keys(ledger.sources).length : null,
    })
  } else if (Array.isArray(doc?.docs)) counts.folders++
  else counts.documents++
  for (const [rank, url, name] of links(doc)) enqueue(rank, url, name ? `${item.path}/${name}` : `${item.path} → ${type ?? "document"}`)
  await release(item.url)
}

/** Work through the queue, in rank order. A connection that fails three times running is replaced. */
async function drain(ms) {
  let streak = 0
  for (let item; (item = queue[SESSIONS].shift() ?? queue[FOLDERS].shift() ?? queue[DOCUMENTS].shift()); ) {
    try {
      await look(item, ms)
      streak = 0
    } catch (err) {
      await release(item.url)
      unreached.push({ ...item, why: /timed out/.test(err?.message) ? "timed out" : "unavailable" })
      if (++streak >= 3) {
        await reconnect()
        streak = 0
      }
    }
  }
}

const started = Date.now()
for (const root of roots) enqueue(SESSIONS, root, "root")
await drain(FIND_MS)

// What was not reached is tried again on a new connection, with longer to
// arrive; and once more if that reached anything, since a document reached
// late may lead to others.
for (let round = 0; round < 2 && unreached.length; round++) {
  const before = unreached.length
  const again = unreached
  unreached = []
  await reconnect()
  for (const item of again) queue[DOCUMENTS].push(item)
  await drain(RETRY_MS)
  if (unreached.length === before) break
}

const sessions = found.filter((f) => f.kind === "session")
const plans = found.filter((f) => f.kind === "plan")
const toMigrate = found.filter((f) => f.migrate)
const running = sessions.filter((f) => f.running)
for (const item of toMigrate) console.log(`  ${DRY ? "would migrate" : "to migrate   "} ${item.kind.padEnd(7)} ${item.url}  ${item.title}${item.kept != null ? `, with a ledger of ${item.kept} kept` : ""}`)
for (const item of running) console.log(`  running now   session ${item.url}  ${item.title}`)
for (const item of unreached) console.log(`  not reached   ${item.url}  (${item.path}: ${item.why})`)
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

await reconnect()
const changed = []
for (const item of toMigrate) {
  try {
    const handle = await open(item.url, RETRY_MS)
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

await reconnect()
let confirmed = 0
for (const item of changed) {
  try {
    const doc = (await open(item.url, RETRY_MS)).doc()
    let ok = doc?.schemaVersion === (item.kind === "session" ? SCHEMA_VERSION : PLAN_VERSION)
    if (ok && item.ledgerUrl) ok = doc.ledgerUrl === item.ledgerUrl && typeOf((await open(item.ledgerUrl, RETRY_MS)).doc()) === LEDGER_TYPE
    if (ok) confirmed++
    else console.log(`  NOT confirmed ${item.kind.padEnd(7)} ${item.url}  ${item.title}`)
  } catch (err) {
    console.log(`  NOT confirmed ${item.kind.padEnd(7)} ${item.url}  ${item.title}  (${err?.message ?? err})`)
  }
}
console.log(`${changed.length} changed, ${confirmed} read back in the current shape from the server; ${toMigrate.length - changed.length} could not be changed.`)
process.exit(confirmed === toMigrate.length && !unreached.length ? 0 : 1)
