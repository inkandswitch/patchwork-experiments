/**
 * The task entry for one burst of a session (kernel/burst.js), as the task
 * system calls it: `default (input, ctx) => result`. Not yet used: today's
 * runners still run sessions.
 *
 * It runs in a pool's worker: a Node host's thread, or a browser pool's run
 * worker. So it imports only what both resolve: its own neighbours, and
 * automerge through host/modules.js (a task's bare imports, tasks/README.md).
 * What only Node has (net/node-fetch.mjs, with its DNS check) is imported
 * only where `process` says this is Node.
 *
 * The input (runners/ask.js), in this order:
 *   session    the session's url
 *   heads      the heads its asker saw, waited for
 *   account    { rootFolderUrl, sensitiveDocs }: where notes are kept, and
 *              the documents that always ask
 *   catalogue  { tools, skills }: installed packages' tools, offered and
 *              parked for a page, and their skills, named
 *   keys       { model, search, relay }
 * and, for probes only, `providerUrl`: where the model provider's requests
 * go instead of its own address. Nothing that asks for a session's work
 * writes it (runners/ask.js), and it is never read from the session.
 *
 * The keys are held in this call's locals and the closures it hands the
 * burst, never on the task's ctx or in module state: a run worker runs the
 * next task on its queue after this one.
 *
 * The result is the burst's: `{ outcome, heads, own }`.
 */

import { runBurst } from "../kernel/burst.js"
import { AGENT } from "../assembly/agent.js"
import { catalogueTools, catalogueSkills } from "../assembly/plugins.js"
import { getProvider } from "../providers/index.js"
import { modelInfo } from "../providers/catalogue.js"
import { guardedFetch, SYNC_SERVERS } from "../net/guard.js"
import { relayFetch } from "../net/relay.js"
import { braveSearch } from "../tools/web.js"
import { recordsOf, isStop } from "../host/task-rules.js"
import { Automerge } from "../host/modules.js"

/** Whether this is a Node host's thread rather than a browser's run worker. */
const inNode = () => typeof process !== "undefined" && !!process.versions?.node

/**
 * The fetch every tool of the run uses, as the old runners wired it: in Node
 * nodeFetch (the sync servers refused, every name resolved and checked,
 * redirects followed by hand), and in a browser's run worker the browser's
 * fetch, refusing this origin and the sync servers, through the person's
 * relay when they have one.
 */
export async function runFetch({ relay = null, node = inNode() } = {}) {
  if (node) {
    const { nodeFetch } = await import("../net/node-fetch.mjs")
    return { fetchImpl: nodeFetch({ sync: process.env.PATCHWORK_SYNC ?? null }), direct: true }
  }
  const send = (url, init) => fetch(url, init)
  return {
    fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => relay }), deny: [globalThis.location?.origin, ...SYNC_SERVERS].filter(Boolean) }),
    direct: !!relay?.url,
  }
}

/**
 * A provider whose requests go to `base` instead of its own address, path
 * kept: for a probe's stand-in. Without `base`, the provider as it is.
 */
export function rebased(provider, base) {
  if (!base) return provider
  const to = String(base).replace(/\/+$/, "")
  const send = (url, init) => fetch(String(url).replace(/^https?:\/\/[^/]+/, to), init)
  return { ...provider, stream: (request) => provider.stream({ ...request, fetchImpl: send }) }
}

/** The ids of a task's runs, read from its document with the rules' reader; a stop is no run. */
export async function runsOfTask(repo, taskUrl) {
  const task = (await repo.find(taskUrl)).doc()
  return recordsOf(task)
    .filter((record) => !isStop(record) && typeof record.id === "string")
    .map((record) => record.id)
}

export default async function sessionTask(input, ctx) {
  const keys = { model: input?.keys?.model ?? null, search: input?.keys?.search ?? null, relay: input?.keys?.relay ?? null }
  const account = input?.account ?? {}
  const catalogue = input?.catalogue ?? { tools: [], skills: [] }
  const providerUrl = typeof input?.providerUrl === "string" && input.providerUrl ? input.providerUrl : null
  if (typeof input?.session !== "string") throw new Error("A session task needs the session's url.")

  const handle = await ctx.repo.find(input.session, { signal: ctx.signal })
  const config = () => handle.doc()?.config ?? {}
  const providerId = () => config().providerId ?? "openrouter"
  const { fetchImpl, direct } = await runFetch({ relay: keys.relay })

  const context = {
    splice: Automerge.splice,
    fetchImpl,
    direct,
    search: braveSearch({ key: () => keys.search, fetchImpl }),
    rootFolderUrl: account.rootFolderUrl ?? null,
    sensitiveDocs: (account.sensitiveDocs ?? []).filter((url) => typeof url === "string" && url),
    skillRegistry: catalogueSkills(catalogue),
    get subject() {
      return handle.doc()?.subject ?? null
    },
    get skillsFolderUrl() {
      return config().skillsFolderUrl ?? null
    },
  }

  return runBurst(ctx, {
    session: input.session,
    heads: Array.isArray(input.heads) ? input.heads : null,
    taskRuns: () => runsOfTask(ctx.repo, ctx.taskUrl),
    getProvider: async () => rebased(getProvider(providerId()), providerUrl),
    key: keys.model,
    // The catalogue the stand-in cannot answer is not asked for.
    getModelInfo: providerUrl ? undefined : (model, id) => modelInfo(id ?? providerId(), model, { key: keys.model }),
    context,
    builtins: AGENT.builtins,
    plugins: async () => catalogueTools(catalogue, { onError: (id, why) => ctx.log?.(`left out ${id}: ${why}`) }),
    sections: AGENT.sections,
    afterCall: AGENT.afterCall,
    system: AGENT.system,
    onEvent: (event) => {
      if (event.type === "call-start") ctx.log?.(`→ ${event.tool}`)
      else if (event.type === "finish") ctx.log?.(`${event.outcome}${event.reason ? `: ${event.reason}` : ""}`)
      else if (event.type === "error") ctx.log?.(`error: ${event.error}`)
    },
  })
}
