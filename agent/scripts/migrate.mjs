#!/usr/bin/env node
/**
 * Bring existing sessions up to the shape the agent now reads, once.
 *
 *   node scripts/migrate.mjs [--dry] [--sync wss://…] automerge:<url> [more…]
 *
 * Each URL is a session, a workflow plan, or a folder. Folders are walked,
 * and from every session and plan found the others they name are followed:
 * a plan's orchestrator and steps, a session's plan, its side threads and
 * the documents it made. Point it at an account's root folder to reach
 * everything filed there.
 *
 * `--dry` changes nothing and says what it would change. Without it, each
 * document is changed in one write, and the script waits for the sync server
 * to have had time to take them before it exits.
 *
 * Delete this file and migrate-session.js once it has been run: the agent
 * reads only the current shape (kernel/runner.js).
 */

import { Repo, initSubduction, setSubductionLogLevel } from "@automerge/automerge-repo"
import { migrateSession } from "./migrate-session.js"

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
  console.error("Usage: node scripts/migrate.mjs [--dry] [--sync wss://…] automerge:<session, plan or folder> [more…]")
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
const counts = { sessions: 0, migrated: 0, current: 0, plans: 0, folders: 0, unreachable: 0 }

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
  if (type === "agent-session") {
    counts.sessions++
    // On a copy first, so a dry run says exactly what a real one would do.
    const copy = JSON.parse(JSON.stringify(doc, (_key, value) => (value instanceof Uint8Array ? null : value)))
    if (migrateSession(copy)) {
      counts.migrated++
      console.log(`  ${DRY ? "would migrate" : "migrated     "} ${key}  ${doc.title ?? "(untitled)"}`)
      if (!DRY) handle.change((d) => migrateSession(d))
    } else {
      counts.current++
    }
  } else if (type === "agent-workflow") {
    counts.plans++
  } else if (Array.isArray(doc?.docs)) {
    counts.folders++
    for (const entry of doc.docs) if (entry?.url) await visit(entry.url, `${path}/${entry.name ?? "?"}`)
    return
  } else {
    return
  }
  for (const next of named(doc)) await visit(next, `${path} → ${type}`)
}

for (const root of roots) await visit(root, bare(root))

console.log(
  `\n${counts.sessions} sessions (${counts.migrated} ${DRY ? "to migrate" : "migrated"}, ${counts.current} already current), ` +
    `${counts.plans} plans, ${counts.folders} folders, ${counts.unreachable} unreachable.`,
)
if (!DRY && counts.migrated) {
  console.log(`Waiting ${Math.round(SETTLE_MS / 1000)} s for the sync server to take the changes…`)
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}
process.exit(counts.unreachable ? 1 : 0)
