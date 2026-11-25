/**
 * Running a session in this tab.
 *
 * The view used to build its runner inline, which meant a session could only
 * run in a tab if a view of it was open. A workflow starts sessions nobody is
 * looking at — its steps — so the recipe lives here, and the view and the
 * workflow driver both use it. Runners are still registered per session in
 * runners/registry.js and outlive whoever started them.
 */

import { handleStore } from "../kernel/store.js"
import { SessionRunner, DEFER_PER_BUSY_MS } from "../kernel/runner.js"
import { ensureRunner as ensureSharedRunner, busyCount } from "./registry.js"
import { createEvents } from "../kernel/events.js"
import { AGENT } from "../assembly/agent.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { loadPluginTools } from "../assembly/plugins.js"
import { ensureDriver, getDriver } from "../workflow/driver.js"
import { getProvider } from "../providers/index.js"
import { readKey, readRelay, SEARCH_KEY_ID } from "../providers/keys.js"
import { modelInfo } from "../providers/catalogue.js"
import { relayFetch } from "../net/relay.js"
import { hostImport } from "../host/import.js"
import { getMount } from "../tools/checking.js"
import { guardedFetch, SYNC_SERVERS, pageOriginFetch } from "../net/guard.js"
import { braveSearch } from "../tools/web.js"
import { packageOfPlugin } from "../knowledge/guides.js"

/**
 * The fetch every tool in this tab uses. It refuses this page's own origin —
 * which serves the person's documents to anyone asking by URL — the sync
 * servers, and every local or private address; see net/guard.js. With a
 * fetch relay set up, GET and HEAD go through it (net/relay.js), read
 * afresh for every request, so setting one up takes effect at once.
 */
export function tabFetch({ relay = () => readRelay() } = {}) {
  return guardedFetch({ fetch: relayFetch({ fetch: (url, init) => fetch(url, init), relay }), deny: [location.origin, ...SYNC_SERVERS] })
}

/**
 * What of the account a runner's context carries: where its documents are
 * filed, and which of them always need an explicit yes, whatever touches
 * them. Plain data, so a tab can hand it to the shared worker; the account's
 * own handle is not in it, and no tool is given one.
 */
export function accountContext(account = globalThis.accountDocHandle) {
  const doc = account?.doc?.() ?? null
  return {
    rootFolderUrl: doc?.rootFolderUrl ?? null,
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
 */
export async function startTabRunner(handle, { repo, subject = null, element = null, canRun = null } = {}) {
  return ensureSharedRunner(handle.url, async (emit) => {
    const automerge = await hostImport("automerge").catch(() => null)
    const splice = automerge?.splice ?? null
    // The registry module, for plugin tools as ctx.plugins.
    const plugins = await hostImport("plugins").catch(() => null)
    // Skills installed packages contribute (knowledge/skills.js packageSkills).
    const skillRegistry = plugins?.getRegistry?.("patchwork:skill") ?? null
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
      // For plugin tools: the page's registry and its automerge, initialised
      // (TOOLS.md).
      plugins,
      automerge,
      events,
      element,
      ...accountContext(),
      skillsFolderUrl: handle.doc()?.config?.skillsFolderUrl ?? null,
      skillRegistry,
      // Which package a plugin came from, for usage guides (knowledge/guides.js):
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
      // How a workflow's steps are run from here: in this tab's runners. Only
      // the workflow tools are handed it (kernel/runner.js privileges).
      startStepSession: stepStarter(repo),
      // The page's own origin, for plugin_source alone (see pageOriginFetch).
      pageFetch: pageOriginFetch({ fetch: (url, init) => fetch(url, init), origin: location.origin }),
    }

    const providerId = () => handle.doc()?.config?.providerId ?? "openrouter"
    const made = new SessionRunner({
      ...AGENT,
      store: liveStore,
      runnerUrl: `tab-${Math.random().toString(36).slice(2, 10)}`,
      ctx,
      // This tab's plugin registry. A research step is offered only the
      // plugins in it that declare `scoped: true` (kernel/toolset.js).
      pluginTools: () => loadPluginTools(),
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

/** Runs a workflow step's session in this tab, as the driver asks (workflow/driver.js). */
const stepStarter = (repo) => async (handle) => {
  const entry = await startTabRunner(handle, { repo, subject: handle.doc()?.subject ?? null })
  return { runner: entry?.runner ?? null, listen: (fn) => entry?.listeners?.add(fn) }
}

/** Every tool this page has, as a driver reads them (workflow/step-tools.js). */
const pageTools = async () => ({ builtins: BUILTIN_TOOLS, plugins: await loadPluginTools().catch(() => []) })

/**
 * Drive a plan from this page, for a view: steps run in this tab's runners,
 * and news goes to the orchestrating session through its runner here. The
 * workflow tools start a driver themselves, with what their runner hands
 * them (workflow/tools.js). `startSession` is for a caller with its own way
 * of running sessions.
 */
export async function drivePlanHere(planUrl, { repo, events = null, startSession = null }) {
  const existing = getDriver(planUrl)
  if (existing) {
    existing.kick()
    return existing
  }
  let channels = events
  if (!channels) {
    const plan = (await repo.find(planUrl)).doc()
    if (plan?.sessionUrl) {
      const entry = await startTabRunner(await repo.find(plan.sessionUrl), { repo, subject: plan.subject ?? null })
      channels = entry?.ctx?.events?.forTool("workflow") ?? null
    }
  }
  return ensureDriver(planUrl, {
    repo,
    startSession: startSession ?? stepStarter(repo),
    tools: pageTools,
    notify: channels ? (url, title) => channels.open(url, { label: `workflow: ${title}` }) : null,
  })
}
