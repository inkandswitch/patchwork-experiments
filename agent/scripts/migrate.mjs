#!/usr/bin/env node
/**
 * Bring existing sessions and workflow plans up to the shape the agent now
 * reads, once.
 *
 *   node scripts/migrate.mjs [--dry] [--sync wss://…] automerge:<url> [more…]
 *
 * Each URL is an account, a folder, a session or a workflow plan. Point it at
 * an account document to reach everything the agent keeps for that account:
 *
 *   - what is filed under its root folder, every folder walked;
 *   - the session the sidebar keeps for a document, on the document itself
 *     (`@patchwork.agent`, ui/panel.js), for every document met on the way;
 *   - the floating box's list of sessions, in the account's tool storage
 *     (ui/ambient.js);
 *   - and from every session and plan found, the others they name: a plan's
 *     orchestrator and steps, a session's plan, its side threads and the
 *     documents it made.
 *
 * `--dry` changes nothing and says what it would change. Without it, each
 * document is changed in one write, and the script waits for the sync server
 * to have had time to take them before it exits. A plan whose research steps
 * kept things gets a ledger document holding them, made before the plan is
 * changed to name it.
 *
 * Delete this file, migrate-session.js and migrate-plan.js once it has been
 * run: the agent reads only the current shape (kernel/runner.js,
 * workflow/driver.js).
 */

import { Repo, initSubduction, setSubductionLogLevel, generateAutomergeUrl } from "@automerge/automerge-repo"
import { migrateSession } from "./migrate-session.js"
import { migratePlan, ledgerFor } from "./migrate-plan.js"

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
/** How long a document may take to arrive before it is counted as unreachable. */
const FIND_MS = Number(option("timeout", 20000))
/** How long to stay connected after the last write, for the server to take it. */
const SETTLE_MS = Number(option("settle", 15000))

if (!roots.length) {
  console.error("Usage: node scripts/migrate.mjs [--dry] [--sync wss://…] automerge:<account, folder, session or plan> [more…]")
  process.exit(2)
}

await initSubduction()
try {
  setSubductionLogLevel("error")
} catch {
  /* older builds do not expose it */
}
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })

const typeOf = (doc) => doc?.["@patchwork"]?.type ?? null
const bare = (url) => String(url).split("#")[0]
const seen = new Set()
const counts = { sessions: 0, migrated: 0, current: 0, plans: 0, plansMigrated: 0, ledgers: 0, folders: 0, documents: 0, unreachable: 0 }

async function open(url) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), FIND_MS))
  return Promise.race([repo.find(bare(url)), timeout])
}

/** The other documents a session or a plan names. */
function named(doc) {
  const urls = []
  if (typeOf(doc) === "agent-session") {
    urls.push(doc.workflow?.planUrl, doc.workflow?.orchestratorUrl, doc.aside?.sessionUrl, doc.aside?.planUrl)
    for (const aside of doc.asides ?? []) urls.push(aside?.url ?? aside?.sessionUrl)
    for (const made of doc.made ?? []) if (["agent-session", "agent-workflow", "folder"].includes(made?.kind)) urls.push(made.url)
  } else if (typeOf(doc) === "agent-workflow") {
    urls.push(doc.sessionUrl, doc.sourcesFolderUrl)
    for (const step of doc.steps ?? []) urls.push(step.sessionUrl, ...(step.previous ?? []).map((p) => p?.sessionUrl))
  }
  return urls.filter((url) => typeof url === "string" && url.startsWith("automerge:"))
}

/** The floating box's entry in an account's tool storage (ui/ambient.js STORAGE_TOOL_ID). */
const AMBIENT_STORAGE = "agent-ambient"

/** Where sessions are kept that no folder, session or plan names. */
function attached(doc) {
  // The sidebar's session for this document, whatever the document is.
  const urls = [doc?.["@patchwork"]?.agent]
  if (typeOf(doc) === "account") urls.push(doc.rootFolderUrl, doc.toolStorage?.[AMBIENT_STORAGE])
  if (typeOf(doc) === "patchwork:tool-storage") urls.push(doc.sessionUrl, ...(Array.isArray(doc.sessions) ? doc.sessions : []))
  return urls.filter((url) => typeof url === "string" && url.startsWith("automerge:"))
}

async function visit(url, path) {
  const key = bare(url)
  if (seen.has(key)) return
  seen.add(key)
  let handle
  try {
    handle = await open(key)
  } catch (err) {
    counts.unreachable++
    console.log(`  unreachable  ${key}  (${path}: ${err.message})`)
    return
  }
  const doc = handle.doc()
  const type = typeOf(doc)
  // On a copy first, so a dry run says exactly what a real one would do.
  const copy = () => JSON.parse(JSON.stringify(doc, (_key, value) => (value instanceof Uint8Array ? null : value)))
  if (type === "agent-session") {
    counts.sessions++
    if (migrateSession(copy())) {
      counts.migrated++
      console.log(`  ${DRY ? "would migrate" : "migrated     "} ${key}  ${doc.title ?? "(untitled)"}`)
      if (!DRY) handle.change((d) => migrateSession(d))
    } else {
      counts.current++
    }
  } else if (type === "agent-workflow") {
    counts.plans++
    const ledger = ledgerFor(copy())
    if (migratePlan(copy(), { ledgerUrl: ledger ? generateAutomergeUrl() : null })) {
      counts.plansMigrated++
      if (ledger) counts.ledgers++
      console.log(`  ${DRY ? "would migrate" : "migrated     "} ${key}  ${doc.title ?? "(untitled plan)"}${ledger ? `, with a ledger of ${Object.keys(ledger.sources).length} kept` : ""}`)
      if (!DRY) {
        const made = ledger ? repo.create(ledger) : null
        handle.change((d) => migratePlan(d, { ledgerUrl: made?.url ?? null }))
      }
    }
  } else if (Array.isArray(doc?.docs)) {
    counts.folders++
    for (const entry of doc.docs) if (entry?.url) await visit(entry.url, `${path}/${entry.name ?? "?"}`)
  } else {
    counts.documents++
  }
  for (const next of [...named(doc), ...attached(doc)]) await visit(next, `${path} → ${type ?? "document"}`)
}

for (const root of roots) await visit(root, bare(root))

console.log(
  `\n${counts.sessions} sessions (${counts.migrated} ${DRY ? "to migrate" : "migrated"}, ${counts.current} already current), ` +
    `${counts.plans} plans (${counts.plansMigrated} ${DRY ? "to migrate" : "migrated"}, ${counts.ledgers} with a ledger), ${counts.folders} folders, ${counts.documents} other documents, ${counts.unreachable} unreachable.`,
)
if (!DRY && (counts.migrated || counts.plansMigrated)) {
  console.log(`Waiting ${Math.round(SETTLE_MS / 1000)} s for the sync server to take the changes…`)
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}
process.exit(counts.unreachable ? 1 : 0)
