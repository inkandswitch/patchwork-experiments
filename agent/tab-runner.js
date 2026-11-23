/**
 * Running a session in this tab.
 *
 * The view used to build its runner inline, which meant a session could only
 * run in a tab if a view of it was open. A workflow starts sessions nobody is
 * looking at — its steps — so the recipe lives here, and the view and the
 * workflow driver both use it. Runners are still registered per session in
 * runners.js and outlive whoever started them.
 */

import { handleStore } from "./store.js"
import { SessionRunner, DEFER_PER_BUSY_MS } from "./runner.js"
import { ensureRunner as ensureSharedRunner, busyCount } from "./runners.js"
import { createEvents } from "./events.js"
import { buildToolset, loadPluginTools } from "./tools/index.js"
import { getProvider, readKey, readRelay, modelInfo, SEARCH_KEY_ID } from "./providers/index.js"
import { relayFetch } from "./tools/relay.js"
import { hostImport } from "./tools/host.js"
import { getMount } from "./tools/checking.js"
import { guardedFetch, SYNC_SERVERS, pageOriginFetch } from "./tools/guard.js"
import { braveSearch } from "./tools/web.js"
import { packageOfPlugin } from "./tools/guides.js"

/**
 * The fetch every tool in this tab uses. It refuses this page's own origin —
 * which serves the person's documents to anyone asking by URL — the sync
 * servers, and every local or private address; see tools/guard.js. With a
 * fetch relay set up, GET and HEAD go through it (tools/relay.js), read
 * afresh for every request, so setting one up takes effect at once.
 */
export function tabFetch({ relay = () => readRelay() } = {}) {
  return guardedFetch({ fetch: relayFetch({ fetch: (url, init) => fetch(url, init), relay }), deny: [location.origin, ...SYNC_SERVERS] })
}

/** The account's documents, as every runner's context carries them. */
export function accountContext(account = globalThis.accountDocHandle) {
  const doc = account?.doc?.() ?? null
  return {
    accountDocHandle: account ?? null,
    rootFolderUrl: doc?.rootFolderUrl ?? null,
    contactUrl: doc?.contactUrl ?? null,
    moduleSettingsUrl: doc?.moduleSettingsUrl ?? null,
    // Documents that always require an explicit yes, whatever touches them.
    sensitiveDocs: [doc?.moduleSettingsUrl, account?.url].filter(Boolean),
  }
}

/**
 * Start (or find) the tab runner for a session.
 *
 *   handle      the session's DocHandle
 *   repo        the page's repo
 *   subject     the document the session is about, if any
 *   element     where host-tier tools mount; swapped as views come and go
 *   canRun      which tiers this runner picks up — fixed for its life
 *   onToolset   told each toolset the runner builds (the view keeps it for cards)
 */
export async function startTabRunner(handle, { repo, subject = null, element = null, canRun = null, onToolset = null } = {}) {
  return ensureSharedRunner(handle.url, async (emit) => {
    const { splice } = await hostImport("automerge").catch(() => ({ splice: null }))
    // Skills installed packages contribute (tools/skills.js packageSkills).
    const skillRegistry = await hostImport("plugins")
      .then((plugins) => plugins.getRegistry("patchwork:skill"))
      .catch(() => null)
    const liveStore = handleStore(handle, splice)
    // How tools wake this session after their calls are over. It belongs to the
    // runner, not the view: a tool may be watching long after the view has gone.
    const events = createEvents(liveStore)

    const fetchImpl = tabFetch()
    // Mutable on purpose: `element` is swapped as views come and go, so
    // host-tier tools always mount into something actually on the page, and
    // becomes null when nothing is watching.
    const ctx = {
      repo,
      subject,
      // The session's own URL, which keeps its prompt cache on one provider.
      // Tools reach the session through the runner (ctx.session, ctx.recall),
      // never by this.
      sessionUrl: handle.url,
      splice,
      events,
      element,
      ...accountContext(),
      skillsFolderUrl: handle.doc()?.config?.skillsFolderUrl ?? null,
      skillRegistry,
      // Which package a plugin came from, for usage guides (tools/guides.js):
      // `{ url, heads, name }` for the package folder behind a plugin id.
      packageOf: async (type, id) => packageOfPlugin((await hostImport("plugins")).getRegistry(type).all().find((p) => p.id === id)),
      // So view_screenshot can photograph a view that view_mount opened.
      getMount,
      fetchImpl,
      // With a relay a tab reaches pages as node does, so it keeps them as
      // node does: the PDF or the page itself, with its text beside it.
      get direct() {
        return !!readRelay()
      },
      // web_search: Brave with the account's key, read afresh so a key saved
      // in settings works at once. Tools get the search, never the key.
      search: braveSearch({ key: () => readKey(SEARCH_KEY_ID), fetchImpl }),
      // The page's own origin, for plugin_source alone (see pageOriginFetch).
      pageFetch: pageOriginFetch({ fetch: (url, init) => fetch(url, init), origin: location.origin }),
    }

    const providerId = () => handle.doc()?.config?.providerId ?? "openrouter"
    const made = new SessionRunner({
      store: liveStore,
      runnerUrl: `tab-${Math.random().toString(36).slice(2, 10)}`,
      ctx,
      buildToolset: (doc) => buildToolset(doc),
      // This tab's plugin registry, for research steps: the plugins that
      // declare `scoped: true` are admitted to them (scope.js admitScoped).
      pluginTools: () => loadPluginTools(),
      onToolset,
      getProvider: async () => getProvider(providerId()),
      getKey: () => readKey(providerId()),
      getModelInfo: (model, id) => modelInfo(id, model, { key: readKey(id) }),
      // Fixed at construction, NOT read live. A `canRun` that consults
      // whether the worker is up flips mid-run the moment it finishes
      // connecting, and the turn in flight then parks on its own worker-tier
      // call. The lease keeps two runners from colliding; this only decides
      // what each is willing to pick up.
      canRun: canRun ?? ((where) => where === "worker" || where === "host"),
      onEvent: emit,
      // A tab already running other sessions holds back a little before taking
      // one more, so a workflow's steps spread over every browser that has it
      // open and a key; alone, it takes them all, just a moment later.
      deferMs: () => busyCount(made) * DEFER_PER_BUSY_MS,
    })
    // The runner watches the document itself, so it hears approvals and
    // messages written from anywhere — with or without a view open.
    const onDocChange = () => made.tick()
    handle.on("change", onDocChange)

    made.start()
    return {
      runner: made,
      ctx,
      dispose: () => {
        handle.off("change", onDocChange)
        events.stop()
      },
    }
  })
}
