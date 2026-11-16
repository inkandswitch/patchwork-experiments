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
import { SessionRunner } from "./runner.js"
import { ensureRunner as ensureSharedRunner } from "./runners.js"
import { createEvents } from "./events.js"
import { buildToolset } from "./tools/index.js"
import { getProvider, readKey, modelInfo } from "./providers/index.js"
import { hostImport } from "./tools/host.js"
import { getMount } from "./tools/checking.js"

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
    const liveStore = handleStore(handle, splice)
    // How tools wake this session after their calls are over. It belongs to the
    // runner, not the view: a tool may be watching long after the view has gone.
    const events = createEvents(liveStore)

    // Mutable on purpose: `element` is swapped as views come and go, so
    // host-tier tools always mount into something actually on the page, and
    // becomes null when nothing is watching.
    const ctx = {
      repo,
      subject,
      // So the agent can name its own conversation. Nothing else may be
      // reached through this — it is the session's own document.
      sessionUrl: handle.url,
      splice,
      events,
      element,
      ...accountContext(),
      skillsFolderUrl: handle.doc()?.config?.skillsFolderUrl ?? null,
      // So view_screenshot can photograph a view that view_mount opened.
      getMount,
    }

    const providerId = () => handle.doc()?.config?.providerId ?? "openrouter"
    const made = new SessionRunner({
      store: liveStore,
      runnerUrl: `tab-${Math.random().toString(36).slice(2, 10)}`,
      ctx,
      buildToolset: async (doc) => {
        const toolset = await buildToolset(doc)
        onToolset?.(toolset)
        return toolset
      },
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
