#!/usr/bin/env node
/**
 * A runner outside the browser.
 *
 * This is the piece that makes an agent session durable. A tab runner dies when
 * you close the tab and a SharedWorker dies with its last client; a process on a
 * machine somewhere keeps going. Because the session is a document and the lease
 * is in it, this needs no new protocol — it claims sessions exactly the way a
 * tab does, and a browser can take one back mid-flight.
 *
 * It also changes what the agent can reach. There is no origin policy here, so
 * the web tools fetch directly instead of going through a third-party reader,
 * and an API that refuses CORS is simply reachable.
 *
 * What it cannot do is host-tier work: there is no DOM and no plugin registry,
 * so `dom_snapshot`, `view_*`, `doc_create` and `tool_install` park until a tab
 * picks them up. That is the tier system doing its job rather than a limitation
 * to work around.
 *
 * Usage:
 *   OPENROUTER_API_KEY=… node node-runner.mjs automerge:<sessionUrl> [more…]
 *   OPENROUTER_API_KEY=… node node-runner.mjs --watch automerge:<queueFolderUrl>
 *
 * web_search needs BRAVE_SEARCH_API_KEY too; without it, it says search is not set up.
 */

import { Repo, initSubduction, setSubductionLogLevel } from "@automerge/automerge-repo"
import { splice } from "@automerge/automerge/slim"

import { handleStore } from "./store.js"
import { SessionRunner, needsWork, heldElsewhere } from "./runner.js"
import { createEvents } from "./events.js"
import { buildToolset } from "./tools/index.js"
import { getProvider, modelInfo } from "./providers/index.js"
import { STATUS } from "./session.js"
import { nodeFetch } from "./node-fetch.mjs"
import { braveSearch } from "./tools/web.js"

const DEFAULT_SYNC = "wss://subduction.sync.inkandswitch.com"

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const sessionUrls = args.filter((arg) => arg.startsWith("automerge:"))

const SYNC = option("sync", process.env.PATCHWORK_SYNC ?? DEFAULT_SYNC)
const KEY = process.env.OPENROUTER_API_KEY
const MODEL_PROVIDER = option("provider", "openrouter")

if (!sessionUrls.length) {
  console.error("Usage: node node-runner.mjs automerge:<sessionUrl> [...]")
  console.error("       --watch automerge:<folderUrl>   claim every session in a folder")
  process.exit(2)
}
if (!KEY) {
  console.error("Set OPENROUTER_API_KEY. The key stays in this process and never enters a document.")
  process.exit(2)
}

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (...parts) => console.log(`[${stamp()}]`, ...parts)

await initSubduction()
try {
  setSubductionLogLevel("error")
} catch {
  /* older builds do not expose it */
}

const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
log(`connected to ${SYNC}`)

// Web tools fetch directly here: no browser, no origin policy, no third party
// in the path. This is the main capability difference from a tab, and why the
// guard matters more here: nothing else stops a request to this machine, its
// network, or the cloud metadata address. Redirects are followed one checked
// hop at a time, and every address a name resolves to must be public.
const fetchImpl = nodeFetch({ sync: SYNC })
// web_search's key (Brave Search API), like the model's: in this process only.
const SEARCH_KEY = process.env.BRAVE_SEARCH_API_KEY || null
const baseCtx = { repo, splice, direct: true, fetchImpl, search: braveSearch({ key: () => SEARCH_KEY, fetchImpl }) }

const runners = new Map()

async function claim(sessionUrl) {
  if (runners.has(sessionUrl)) return runners.get(sessionUrl)

  const handle = await repo.find(sessionUrl)
  const doc = handle.doc()
  if (!doc) {
    log(`could not load ${sessionUrl}`)
    return null
  }

  const store = handleStore(handle, splice)
  const runnerUrl = `node-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  const runner = new SessionRunner({
    store,
    runnerUrl,
    // The runner decides from the session document what of this the tools
    // get (runner.js, scope.js): a research step gets none of the subject and
    // a repo that opens only its workflow's ledger.
    ctx: { ...baseCtx, sessionUrl, subject: doc.subject ?? null, events: createEvents(store) },
    buildToolset: (sessionDoc) => buildToolset(sessionDoc),
    // No pluginTools: node has no plugin registry, so research steps here get
    // the built-ins alone.
    getProvider: async () => getProvider(doc.config?.providerId ?? MODEL_PROVIDER),
    getKey: () => KEY,
    getModelInfo: (model, providerId) => modelInfo(providerId ?? MODEL_PROVIDER, model, { key: KEY }),
    // No DOM, no registry. Host-tier calls park for a tab to pick up.
    canRun: (where) => where === "worker" || where === "task",
    onEvent: (event) => {
      if (event.type === "call-start") log(`  → ${event.tool}`)
      else if (event.type === "call-end") log(`  ← ${event.summary}`)
      else if (event.type === "compacting") log(`  compacting ${event.turns} turns`)
      else if (event.type === "retry") log(`  retrying (${event.status ?? event.reason}) in ${event.delay}ms`)
      else if (event.type === "reconnecting") log(`  waiting for the network; attempt ${event.attempt + 1} in ${event.delay}ms`)
      else if (event.type === "finish") log(`  ${event.outcome}${event.reason ? `: ${event.reason}` : ""}`)
      else if (event.type === "error") log(`  error: ${event.error}`)
    },
  })

  handle.on("change", () => runner.tick())
  runner.start()
  runners.set(sessionUrl, { runner, handle })

  const title = doc.title ?? "Agent"
  log(`claimed ${title} (${sessionUrl}) as ${runnerUrl}`)
  if (doc.status === STATUS.parked) {
    log("  note: this session is parked on a call that needs a browser tab")
  }
  return runner
}

for (const url of sessionUrls) {
  if (flag("watch")) {
    // Treat the url as a folder and claim every agent session inside it, so a
    // runner can be pointed at a working folder rather than one session.
    const folder = await repo.find(url)
    const scan = async () => {
      for (const entry of folder.doc()?.docs ?? []) {
        if (runners.has(entry.url)) continue
        try {
          const candidate = (await repo.find(entry.url)).doc()
          if (candidate?.["@patchwork"]?.type === "agent-session") await claim(entry.url)
        } catch {
          /* not readable; skip */
        }
      }
    }
    folder.on("change", scan)
    await scan()
    log(`watching ${url} for agent sessions`)
  } else {
    await claim(url)
  }
}

// A quiet heartbeat so it is obvious the process is alive and what it is doing.
setInterval(() => {
  const lines = []
  for (const [url, { handle, runner }] of runners) {
    const doc = handle.doc()
    if (!doc) continue
    const mine = doc.lease?.runner === runner.runnerUrl
    const elsewhere = heldElsewhere(doc, runner.runnerUrl, runner.live)
    lines.push(
      `${doc.title ?? url.slice(0, 20)}: ${doc.status}${mine ? " (ours)" : elsewhere ? " (held elsewhere)" : ""}${needsWork(doc, runner.canRun, runner.live) ? " · work waiting" : ""}`
    )
  }
  if (lines.length) log(lines.join(" | "))
}, 30000)

const shutdown = async () => {
  log("shutting down; releasing leases")
  for (const { runner } of runners.values()) runner.stop()
  try {
    await repo.shutdown?.()
  } catch {
    /* best effort */
  }
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

log(`running ${runners.size} session(s). Ctrl-C to stop.`)
