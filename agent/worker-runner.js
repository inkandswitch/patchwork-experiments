/**
 * The SharedWorker runner.
 *
 * One runner per browser profile, shared by every tab, surviving navigation
 * between documents and reloads. It owns its own automerge Repo, connected to
 * the page's repo over a donated MessagePort, so it keeps working while you
 * move around Patchwork.
 *
 * What it is NOT: a way to survive closing the last tab. A SharedWorker's
 * lifetime is tied to its clients — when the last one goes, so does this. The
 * thing that outlives the browser is a runner elsewhere claiming the session's
 * lease, which is why the lease exists and why this file shares `SessionRunner`
 * with every other environment.
 *
 * Two environment problems are solved at init, both measured in
 * probes/worker-repo.mjs:
 *
 *   1. No importmap. The page resolves its importmap to absolute URLs and sends
 *      the table; `setHostUrls` teaches `hostImport` to use it. No CDN shim.
 *   2. The subduction wasm loader reaches for DOM APIs that a worker does not
 *      have. A six-property `document` shim gets it through; the shim is only
 *      installed if there is genuinely no document.
 */

import { handleStore } from "./store.js"
import { SessionRunner } from "./runner.js"
import { buildToolset } from "./tools/index.js"
import { setHostUrls } from "./tools/host.js"
import { getProvider } from "./providers/index.js"

/** The wasm loader wants a DOM. Give it the smallest one that works. */
function shimDocument() {
  if (typeof document !== "undefined") return false
  globalThis.document = {
    baseURI: self.location.href,
    currentScript: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
  }
  return true
}

let repo = null
let automerge = null
const runners = new Map() // sessionUrl -> { runner, store, ports:Set }
const clients = new Set()

async function ensureRepo(urls, repoPort) {
  if (repo) return repo
  setHostUrls(urls)
  shimDocument()

  const repoModule = await import(/* @vite-ignore */ urls["@automerge/automerge-repo"])
  automerge = await import(/* @vite-ignore */ urls["@automerge/automerge/slim"])
  const adapterModule = await import(
    /* @vite-ignore */ urls["@automerge/automerge-repo-network-messagechannel"]
  )

  if (typeof repoModule.initSubduction === "function") await repoModule.initSubduction()

  const Adapter = adapterModule.MessageChannelNetworkAdapter ?? adapterModule.default
  repo = new repoModule.Repo({ network: [new Adapter(repoPort)] })
  return repo
}

function broadcast(sessionUrl, message) {
  const entry = runners.get(sessionUrl)
  for (const port of entry?.ports ?? clients) {
    try {
      port.postMessage(message)
    } catch {
      /* a closed port; the client is gone */
    }
  }
}

async function startSession({ sessionUrl, subject, key, providerId, system }, port) {
  const existing = runners.get(sessionUrl)
  if (existing) {
    existing.ports.add(port)
    existing.key = key
    existing.runner.tick()
    return { type: "ready", sessionUrl, runnerUrl: existing.runner.runnerUrl, reused: true }
  }

  const handle = await repo.find(sessionUrl)
  const store = handleStore(handle, automerge?.splice ?? null)

  const entry = { ports: new Set([port]), key }
  const runner = new SessionRunner({
    store,
    runnerUrl: `worker-${Math.random().toString(36).slice(2, 10)}`,
    ctx: { repo, subject, splice: automerge?.splice ?? null },
    buildToolset: (doc) => buildToolset(doc),
    getProvider: async () => getProvider(providerId ?? "openrouter"),
    // The key is passed in per session rather than read from storage: a worker
    // has no access to the page's localStorage.
    getKey: () => entry.key,
    // A worker has no DOM and no plugin registry. Host-tier calls park here and
    // are picked up by a tab.
    canRun: (where) => where === "worker",
    system,
    onEvent: (event) => broadcast(sessionUrl, { type: "event", sessionUrl, event }),
  })

  entry.runner = runner
  entry.store = store
  runners.set(sessionUrl, entry)

  // Re-check whenever the document changes — the tab writes the user's message
  // into the session, and this is how the worker notices.
  handle.on("change", () => runner.tick())
  runner.start()

  return { type: "ready", sessionUrl, runnerUrl: runner.runnerUrl, reused: false }
}

self.onconnect = (event) => {
  const port = event.ports[0]
  clients.add(port)
  port.start()

  port.onmessage = async (message) => {
    const data = message.data ?? {}
    try {
      if (data.type === "init") {
        await ensureRepo(data.urls, data.repoPort)
        port.postMessage(await startSession(data, port))
        return
      }

      const entry = runners.get(data.sessionUrl)
      if (!entry) return

      if (data.type === "tick") entry.runner.tick()
      else if (data.type === "interrupt") entry.runner.interrupt()
      else if (data.type === "key") entry.key = data.key
      else if (data.type === "detach") entry.ports.delete(port)
    } catch (err) {
      port.postMessage({
        type: "error",
        sessionUrl: data.sessionUrl ?? null,
        error: String(err?.message ?? err),
        stack: String(err?.stack ?? "").slice(0, 600),
      })
    }
  }
}
