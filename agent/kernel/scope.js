/**
 * Research steps: confined by construction.
 *
 * A web-only step of a workflow fetches freely — it has standing permission
 * for any site — and that is safe only if nothing of the person's can reach
 * what it sends. Saying so in its prompt would be a request, not a guarantee:
 * a page it reads can tell it otherwise. So the confinement lives here, in
 * what a step's tools are handed, and one field of the session drives all of
 * it:
 *
 *   session.scope = { kind: "web", ledgerUrl: <the plan>, stepId }
 *
 * From that alone the runner — in a tab, a worker or node — builds the step's
 * toolset (`scopedToolset`) and its context (`confine`). The context has no
 * field that names the person's documents, and its repo (`scopedRepo`) opens
 * only what is in the plan's ledger of kept things, `plan.sources`, at the
 * heads recorded there. Membership is the read capability: a URL found in a
 * page, any spelling of any id, another step's session, the plan itself — none
 * is in the ledger, so none opens, and the refusal happens before the repo is
 * even asked, so a URL from a page never causes a sync request either.
 *
 * What goes into the ledger comes only from the web and from what the
 * orchestrator chose to write into research prompts, so a research step can
 * keep and re-read everything it finds without ever holding anything else.
 */

import { AutomergeRepo } from "../host/modules.js"
import { documentIdOf } from "../documents/doc-urls.js"
import { readable } from "../documents/media.js"
import { declaresScoped, scopedTools, toolsetOf } from "./toolset.js"
import { isKernel, refuse } from "./kernel-repo.js"

const { isValidAutomergeUrl, stringifyAutomergeUrl } = AutomergeRepo

export const NOT_A_SOURCE = "Not one of this workflow's sources."

export const EDITED_OUTSIDE = "This finding changed outside the research steps; write a new one."

/** Why a session will not run: its scope is malformed, or disagrees with its plan. */
export class ScopeRefusal extends Error {}

/** The scope a web step of `planUrl` must carry, exactly. */
export function webScope(planUrl, stepId) {
  return { kind: "web", ledgerUrl: planUrl, stepId }
}

/** Two scopes are the same when every field is; null is the same only as null. */
export function sameScope(a, b) {
  if (!a || !b) return !a && !b
  return a.kind === b.kind && a.ledgerUrl === b.ledgerUrl && a.stepId === b.stepId
}

/**
 * The scope a session runs under: null for full access, or a plain copy of a
 * well-formed one. Anything else throws, because a scope that cannot be read
 * must not be read as "no scope": that would turn a damaged research step into
 * one with the person's documents.
 */
export function scopeOf(doc) {
  const scope = doc?.scope
  if (scope === undefined || scope === null) return null
  const keys = scope && typeof scope === "object" ? Object.keys(scope).sort().join() : ""
  const ledger = typeof scope?.ledgerUrl === "string" ? scope.ledgerUrl : ""
  const wellFormed =
    keys === "kind,ledgerUrl,stepId" &&
    scope.kind === "web" &&
    isValidAutomergeUrl(ledger) &&
    // The plan itself, not a part of it or a version of it.
    stringifyAutomergeUrl({ documentId: documentIdOf(ledger) }) === ledger &&
    typeof scope.stepId === "string" &&
    scope.stepId.length > 0
  if (!wellFormed) throw new ScopeRefusal("This session's research scope is malformed, so it will not run.")
  return webScope(ledger, scope.stepId)
}

/** A plan's step, or null when the plan is not one or has no such step. */
async function planStep(repo, planUrl, stepId) {
  if (!repo?.find) throw new ScopeRefusal("This runner has no repo, so it cannot check what this step may reach.")
  let plan
  try {
    plan = (await repo.find(planUrl)).doc()
  } catch {
    throw new ScopeRefusal("This step's workflow plan could not be read, so what the step may reach cannot be checked.")
  }
  if (plan?.["@patchwork"]?.type !== "agent-workflow") return null
  return (plan.steps ?? []).find((s) => s.id === stepId) ?? null
}

/**
 * Does the session's scope agree with its plan? Throws when it does not.
 *
 * Checked from both ends. A session that names a plan whose step is web-only
 * must carry exactly that step's scope — so deleting the scope, or pointing it
 * at another plan, does not turn a research step into a full one. And a scope
 * must name a web-only step of a real plan, so a scope cannot be made up.
 */
export async function assertScopeAgrees(doc, scope, repo) {
  const named = doc?.workflow
  if (named?.planUrl && named?.stepId) {
    const step = await planStep(repo, named.planUrl, named.stepId)
    if (step?.access === "web" && !sameScope(scope, webScope(named.planUrl, named.stepId))) {
      throw new ScopeRefusal("Its workflow makes this a web-only research step, but the session is not confined to that research, so it will not run.")
    }
  }
  if (scope) {
    const step = await planStep(repo, scope.ledgerUrl, scope.stepId)
    if (step?.access !== "web") throw new ScopeRefusal("This session's research scope names no web-only step of that workflow, so it will not run.")
  }
}

/**
 * The context a research step's tools get, field by field from an allowlist.
 *
 * Built, not filtered: a field added to the runner's context later is absent
 * here until someone adds it below on purpose. So there is no
 * subject, no root, notes or skills folder, no account, no session URL, no
 * page, and no way to start a workflow — and with no root or skills folder,
 * the notes and the person's own skills are simply not in the prompt.
 *
 * `ctx.repo` here is the runner's own repo, and is used for nothing but
 * building the scoped one.
 */
export async function confine(ctx, scope) {
  if (!ctx?.repo?.find) throw new ScopeRefusal("This runner has no repo, so a research step cannot keep anything here.")
  const ledger = await ctx.repo.find(scope.ledgerUrl)
  return {
    signal: ctx.signal,
    events: ctx.events,
    direct: ctx.direct,
    reader: ctx.reader,
    fetchImpl: ctx.fetchImpl,
    search: ctx.search,
    repo: scopedRepo(ctx.repo, ledger, scope),
    scope: { stepId: scope.stepId },
  }
}

/** Heads as a set: two peers at one version may list them in different orders. */
function sameHeads(a, b) {
  const left = new Set(a ?? [])
  const right = new Set(b ?? [])
  return left.size === right.size && [...left].every((h) => right.has(h))
}

/**
 * What a kept document is, for the ledger and the Sources folder: a finding,
 * a document of some package's own datatype by that type (a web-snapshot,
 * say), or a kind of file.
 */
function whatOf(doc) {
  if (doc?.role === "finding") return "finding"
  const type = doc?.["@patchwork"]?.type
  if (type && type !== "file") return type
  if (doc?.role === "extract") return "extract"
  if (doc?.mimeType === "application/pdf") return "pdf"
  return "file"
}

/**
 * A repo whose read capability is ledger membership.
 *
 *   find(x)      x names a document in `ledger.sources` (any spelling), or it
 *                throws before the repo is asked. A source is read-only and
 *                read at the heads recorded for it; a finding may also be
 *                changed, but only while nobody else has changed it since.
 *   create2()    a new document, entered in the ledger at once; it may be
 *                changed for as long as the call that made it holds it.
 *   sources()    the ledger, newest first: what may be read.
 *
 * Nothing else: no delete, no handles, no network. Every change through it
 * records the document's new heads in the ledger, which is how what the step
 * reads next is exactly what it wrote.
 */
export function scopedRepo(repo, ledger, { stepId }) {
  const entry = (id) => ledger.doc()?.sources?.[id] ?? null
  const required = (id) => {
    const found = entry(id)
    if (!found) throw new Error(NOT_A_SOURCE)
    return found
  }

  /** The document at its recorded heads. Live when nothing has moved them, which is also the only way to read a document with no changes yet. */
  const read = (handle, id) => {
    const { heads } = required(id)
    return sameHeads(handle.heads(), heads) ? handle.doc() : handle.view([...heads]).doc()
  }

  /**
   * Say in the ledger what a document now is. `kind` is decided by the first
   * description and fixed after it, so a source cannot later become a
   * finding and turn writable.
   */
  const describe = (id, handle) => {
    const doc = handle.doc()
    const text = readable(doc)
    const facts = {
      what: whatOf(doc),
      // Its datatype, which is what it is filed in the Sources folder as.
      type: doc?.["@patchwork"]?.type ?? "file",
      source: typeof doc?.source === "string" ? doc.source : null,
      name: doc?.name ?? doc?.title ?? null,
      engine: doc?.capture?.engine ?? null,
      chars: text == null ? null : text.length,
    }
    ledger.change((d) => {
      const e = d.sources[id]
      if (e.what == null) e.kind = doc?.role === "finding" ? "finding" : "source"
      for (const [key, value] of Object.entries(facts)) if (e[key] !== value) e[key] = value
      e.heads = [...handle.heads()]
    })
  }

  const readOnly = (handle, id, url) =>
    Object.freeze({ url, documentId: id, doc: () => read(handle, id), heads: () => [...required(id).heads] })

  const writable = (handle, id, url) =>
    Object.freeze({
      url,
      documentId: id,
      doc: () => read(handle, id),
      heads: () => [...required(id).heads],
      change(fn) {
        // A person may edit a finding; the step must not then build on text
        // it cannot see, nor have their edit silently merged under its own.
        if (!sameHeads(handle.heads(), required(id).heads)) throw new Error(EDITED_OUTSIDE)
        // Nor make a session or a plan, which the driver would file into
        // the person's Sources folder as one: a throw inside the change
        // abandons it, as kernelRepo's do.
        handle.change((d) => {
          fn(d)
          if (isKernel(d)) refuse()
        })
        describe(id, handle)
      },
    })

  return Object.freeze({
    async find(name) {
      const id = documentIdOf(name)
      // Before the repo is asked: a URL lifted from a page must not even
      // cause a sync request for a document this step may not have.
      if (!id) throw new Error(NOT_A_SOURCE)
      const e = required(id)
      const handle = await repo.find(stringifyAutomergeUrl({ documentId: id }))
      return e.kind === "finding" ? writable(handle, id, e.url) : readOnly(handle, id, e.url)
    },

    async create2() {
      const handle = await repo.create2()
      const id = handle.documentId
      // At once, before anything is written into it: what this step makes is
      // the ledger's from the start, so a crash leaves a document nobody can
      // read rather than one outside the ledger that someone could.
      ledger.change((d) => {
        if (!d.sources) d.sources = {}
        d.sources[id] = {
          url: handle.url,
          kind: "source",
          what: null,
          type: null,
          source: null,
          name: null,
          engine: null,
          chars: null,
          by: stepId,
          at: Date.now(),
          heads: [...handle.heads()],
        }
      })
      return writable(handle, id, handle.url)
    },

    sources() {
      return Object.entries(ledger.doc()?.sources ?? {})
        .filter(([, e]) => e?.what != null)
        .map(([id, e]) => ({
          id,
          url: e.url,
          kind: e.kind,
          what: e.what,
          type: e.type ?? null,
          source: e.source ?? null,
          name: e.name ?? null,
          engine: e.engine ?? null,
          chars: e.chars ?? null,
          by: e.by ?? null,
          at: e.at ?? 0,
        }))
        .sort((a, b) => b.at - a.at)
    },
  })
}

export const UNDECLARED_MID_RUN = "This plugin was registered again during the run without declaring `scoped: true`; a research step cannot run it."

/**
 * A plugin tool as a research step runs it. A plugin is there only because
 * it declares `scoped: true` (kernel/toolset.js scopedTools): the declaration
 * is the package's word that its tool works only through the context it is
 * handed, and that context is the step's confined one (`confine`) and nothing
 * more. Installing a package that makes the declaration extends what research
 * steps can do: that is the trust it asks for, and the README says so.
 *
 * The declaration is checked again at every call, on the plugin about to
 * run: the registry holds one plugin per id, and any package may register
 * an id again during a run, which replaces what was admitted. What runs is
 * then the new plugin, and only if it too declares.
 */
function admitted(tool) {
  return Object.freeze({
    ...tool,
    async execute(input, ctx) {
      const now = await tool.current()
      if (!declaresScoped(now)) throw new ScopeRefusal(UNDECLARED_MID_RUN)
      return now.module.execute(input, ctx)
    },
  })
}

/**
 * The toolset of a research step, frozen: the built-ins that declare
 * `scoped`, each the built-in itself, then the plugins that do, out of
 * `plugins` — what this runner's own registry loaded, or lists for a tab to
 * run (kernel/placement.js). Whatever the session says about its tools is not
 * consulted — it is not the session's to say — but whether it is a step is:
 * a confined session that is not one, a side thread copied from a step
 * (workflow/aside.js), has no orchestrator to ask for work.
 */
export function scopedToolset(doc, { builtins = [], plugins = [] } = {}) {
  const own = new Set(builtins)
  const tools = scopedTools(doc, { builtins, plugins: (plugins ?? []).filter((tool) => typeof tool.current === "function") })
  const toolset = toolsetOf(Object.freeze(tools.map((tool) => (own.has(tool) ? tool : admitted(tool)))))
  return Object.freeze({ ...toolset, schemas: Object.freeze(toolset.schemas) })
}
