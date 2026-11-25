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
 * Four environment problems are solved at init. The first two are measured in
 * probes/worker-repo.mjs, all four in probes/worker-plugin-tool.mjs:
 *
 *   1. No importmap. The page resolves its importmap to absolute URLs and sends
 *      the table; `setHostUrls` teaches `hostImport` to use it. No CDN shim.
 *      Nothing of this package is imported until the table is set: its
 *      modules take automerge from host/modules.js, which imports through the
 *      table, so this file imports only the table statically and the rest
 *      once `init` has arrived.
 *   2. The subduction wasm loader reaches for DOM APIs that a worker does not
 *      have. A six-property `document` shim gets it through; the shim is only
 *      installed if there is genuinely no document.
 *   3. Automerge's slim build is uninitialised here. The page names the wasm
 *      its own boot loaded (host/import.js workerPreparation) and the worker
 *      initialises it before the first Repo, which otherwise dies with
 *      "Automerge.use() not called".
 *   4. No plugin registry. The page sends every `agent:tool` entry's metadata,
 *      and again when the registry changes; the worker loads and runs those
 *      it can, and lists the rest as host-tier, so their calls go to a tab
 *      (runners/worker-plugins.js). Its sessions get the tools a tab's would. With
 *      them comes where each plugin of every kind came from, so a session
 *      here is handed a package's usage guide when a tab's would be.
 */

import { setHostUrls } from "../host/urls.js"

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
let booting = null
let automerge = null
let lib = null // this package's modules, imported once the table is set
let catalogue = null // the page registry's agent:tool plugins (worker-plugins.js)
let pluginsModule = null // @inkandswitch/patchwork-plugins in this realm, for ctx.plugins
let mirror = null // fills its registry from the page's (worker-plugins.js)
const runners = new Map() // sessionUrl -> { runner, store, ports:Set }
const clients = new Set()

/** Boot once, however many tabs say `init` at once. */
function ensureRepo(urls, repoPort, prepare) {
  booting ??= boot(urls, repoPort, prepare).catch((err) => {
    booting = null
    throw err
  })
  return booting
}

async function boot(urls, repoPort, prepare) {
  setHostUrls(urls)
  shimDocument()

  const { initAutomergeHere, tryHostImport } = await import("../host/import.js")
  await initAutomergeHere(prepare)
  const [store, runner, events, tools, providers, guard, plugins] = await Promise.all([
    import("../kernel/store.js"),
    import("../kernel/runner.js"),
    import("../kernel/events.js"),
    import("../tools/index.js"),
    import("../providers/index.js"),
    import("../net/guard.js"),
    import("./worker-plugins.js"),
  ])
  lib = { ...store, ...runner, ...events, ...tools, ...providers, ...guard }
  catalogue = plugins.createPluginCatalogue()
  // The registry module, for plugin tools as ctx.plugins, holding the page's
  // views and datatypes (runners/worker-plugins.js createRegistryMirror).
  pluginsModule = await tryHostImport("plugins")
  mirror = plugins.createRegistryMirror(pluginsModule)

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

async function startSession({ sessionUrl, subject, key, providerId, system, account }, port) {
  const { handleStore, SessionRunner, createEvents, buildToolset, getProvider, modelInfo, guardedFetch, SYNC_SERVERS } = lib
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
    // The account's documents come from the tab: a worker has no
    // accountDocHandle. Without them discovery, notes and the sensitive-document
    // check had nothing to go on here.
    ctx: {
      repo,
      subject,
      sessionUrl,
      splice: automerge?.splice ?? null,
      events: createEvents(store),
      rootFolderUrl: account?.rootFolderUrl ?? null,
      contactUrl: account?.contactUrl ?? null,
      moduleSettingsUrl: account?.moduleSettingsUrl ?? null,
      sensitiveDocs: (account?.sensitiveDocs ?? []).filter(Boolean),
      // Which package a plugin came from, for usage guides (knowledge/guides.js),
      // from the index the page sends with its plugins.
      packageOf: (type, id) => catalogue.packageOf(type, id),
      // For plugin tools, as a tab gives them: the registry, and automerge
      // initialised (README, "Writing an agent tool").
      plugins: pluginsModule,
      automerge,
      // The worker shares the page's origin, so it refuses the same places.
      fetchImpl: guardedFetch({ fetch: (url, init) => fetch(url, init), deny: [self.location.origin, ...SYNC_SERVERS] }),
    },
    // The page registry's plugins, as the page last described them: the
    // same tools a tab's session gets, loaded here where they can be.
    buildToolset: (doc) => buildToolset(doc, { plugins: () => catalogue.tools() }),
    // And for research steps, those of them that declare `scoped: true`
    // (kernel/scope.js admitScoped), with the step's confined context.
    pluginTools: () => catalogue.tools(),
    getProvider: async () => getProvider(providerId ?? "openrouter"),
    // The key is passed in per session rather than read from storage: a worker
    // has no access to the page's localStorage.
    getKey: () => entry.key,
    getModelInfo: (model, providerId) => modelInfo(providerId ?? "openrouter", model, { key: entry.key }),
    // A worker has no DOM. Host-tier calls park here and are picked up by a
    // tab — the page's own tools, and plugins that cannot load here.
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
        await ensureRepo(data.urls, data.repoPort, data.prepare)
        if (data.plugins) catalogue.set(data.plugins, data.packages)
        mirror?.set(data.packages)
        port.postMessage(await startSession(data, port))
        return
      }
      // The page's registry changed: a package installed, removed, or edited.
      if (data.type === "plugins") {
        catalogue?.set(data.plugins, data.packages)
        mirror?.set(data.packages)
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
