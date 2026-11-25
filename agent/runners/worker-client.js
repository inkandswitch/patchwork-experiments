/**
 * Main-thread half of the SharedWorker runner.
 *
 * Its whole job is to hand the worker what it cannot get for itself: the
 * importmap resolved to absolute URLs, the wasm automerge needs initialising
 * with, a network port into this page's repo, the API key (which lives in
 * this page's localStorage and must never go into the session document), and
 * what this page's plugin registry holds — every `agent:tool` entry's
 * metadata, and which package each tool, view and datatype came from — sent
 * again whenever the registry changes (runners/worker-plugins.js).
 *
 * Everything here degrades: if the worker cannot be started — no SharedWorker,
 * a CSP that forbids it, a module that fails to load — `connectWorkerRunner`
 * returns null and the caller keeps using the in-tab runner. A worker is an
 * optimization, not a requirement.
 */

import { hostImport, tryHostImport, workerPreparation } from "../host/import.js"

const WORKER_NAME = "patchwork-agent-runner"

/**
 * Resolve the page's importmap to absolute URLs.
 *
 * This is what lets worker code `import()` automerge without an importmap and
 * without a CDN-hosted shim.
 */
export function resolveImportMap(doc = document) {
  const script = doc.querySelector('script[type="importmap"]')
  if (!script) return null
  try {
    const map = JSON.parse(script.textContent)
    const urls = {}
    for (const [specifier, target] of Object.entries(map.imports ?? {})) {
      urls[specifier] = new URL(target, location.href).href
    }
    return urls
  } catch {
    return null
  }
}

/** Where this package's files are served from, derived from our own URL. */
export function workerUrl() {
  return new URL("./worker.js", import.meta.url).href
}

/**
 * Start (or join) the shared runner for one session.
 *
 * @returns {Promise<null | {runnerUrl, tick, interrupt, setKey, close}>}
 */
export async function connectWorkerRunner({
  repo,
  sessionUrl,
  subject,
  key,
  providerId,
  system,
  account,
  onEvent,
  timeoutMs = 20000,
}) {
  if (typeof SharedWorker === "undefined") return null

  const urls = resolveImportMap()
  if (!urls?.["@automerge/automerge-repo"]) return null

  let worker
  try {
    worker = new SharedWorker(workerUrl(), { type: "module", name: WORKER_NAME })
  } catch {
    return null // no SharedWorker here; the tab runner covers it
  }

  // A channel between this page's repo and the worker's.
  let channel
  try {
    const adapterModule = await hostImport("messagechannel")
    const Adapter = adapterModule.MessageChannelNetworkAdapter ?? adapterModule.default
    channel = new MessageChannel()
    if (!repo?.networkSubsystem?.addNetworkAdapter) return null
    repo.networkSubsystem.addNetworkAdapter(new Adapter(channel.port1))
  } catch {
    return null
  }

  const port = worker.port
  port.start()

  const ready = new Promise((resolve) => {
    const onMessage = (event) => {
      const data = event.data ?? {}
      if (data.type === "ready" && data.sessionUrl === sessionUrl) {
        resolve(data)
      } else if (data.type === "error") {
        // Surface it, but do not reject: an error on one session should not
        // tear down a worker shared with others.
        onEvent?.({ type: "worker-error", error: data.error })
        resolve(null)
      } else if (data.type === "event" && data.sessionUrl === sessionUrl) {
        onEvent?.(data.event)
      }
    }
    port.addEventListener("message", onMessage)
    setTimeout(() => resolve(null), timeoutMs)
  })

  // This page's agent:tool plugins, for the worker to list and load. Sent
  // again when the registry changes, so a package installed, removed or
  // edited reaches the worker's next run as it reaches this page's.
  // Loaded late: the tool registry imports package_test, which imports this.
  // With them, where each tool, view and datatype came from (packageIndex), so
  // the worker can hand a session a package's usage guide as a tab would.
  const { pluginDescriptions } = await import("../tools/index.js")
  const { packageIndex, PACKAGE_TYPES } = await import("./worker-plugins.js")
  const host = await tryHostImport("plugins")
  const getRegistry = (type) => host?.getRegistry?.(type) ?? null
  const registry = getRegistry("agent:tool")
  const plugins = await pluginDescriptions({ registry }).catch(() => [])
  const packages = packageIndex(getRegistry)
  const unwatches = []
  let queued = false
  const resend = () => {
    if (queued) return
    queued = true
    // One message for a package's worth of registrations.
    queueMicrotask(async () => {
      queued = false
      try {
        port.postMessage({ type: "plugins", plugins: await pluginDescriptions({ registry }), packages: packageIndex(getRegistry) })
      } catch {
        /* the worker is gone */
      }
    })
  }
  for (const type of PACKAGE_TYPES) {
    const watched = getRegistry(type)
    if (typeof watched?.on !== "function") continue
    const off = watched.on("changed", resend)
    unwatches.push(typeof off === "function" ? off : () => watched.off?.("changed", resend))
  }
  const unwatch = () => unwatches.forEach((off) => off())

  port.postMessage(
    {
      type: "init",
      urls,
      prepare: workerPreparation(urls),
      plugins,
      packages,
      repoPort: channel.port2,
      sessionUrl,
      subject: subject ?? null,
      key: key ?? null,
      providerId: providerId ?? "openrouter",
      system: system ?? null,
      account: account ?? null,
    },
    [channel.port2]
  )

  const answer = await ready
  if (!answer) {
    unwatch()
    return null
  }

  return {
    runnerUrl: answer.runnerUrl,
    reused: answer.reused,
    tick: () => port.postMessage({ type: "tick", sessionUrl }),
    interrupt: () => port.postMessage({ type: "interrupt", sessionUrl }),
    setKey: (value) => port.postMessage({ type: "key", sessionUrl, key: value }),
    close: () => {
      unwatch()
      try {
        port.postMessage({ type: "detach", sessionUrl })
        port.close()
      } catch {
        /* already gone */
      }
    },
  }
}
