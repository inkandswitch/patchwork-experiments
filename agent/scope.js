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
 *
 * `kernelRepo` is the other half. Every other session's tools get a repo whose
 * handles refuse to change a session or a plan, or to make a document into
 * one, and which makes none itself; so no agent tool — doc_edit, fs_write, a
 * plugin — can rewrite a step's scope, its grants, or the ledger, or forge a
 * plan for the driver to run. The two modules that legitimately write those
 * are handed explicit capabilities instead (`ctx.workflows`, `ctx.session`;
 * see runner.js `privileges`), for their own calls only: no other tool, and
 * no plugin, ever holds the real repo or a writer of a session.
 */

import { addedHeads } from "./own-changes.js"
import * as A from "@automerge/automerge"
import { interpretAsDocumentId, isValidAutomergeUrl, stringifyAutomergeUrl, decodeHeads, encodeHeads } from "@automerge/automerge-repo"
import { repairDocUrl } from "./doc-urls.js"
import { readable } from "./tools/sources.js"

/** The documents only the runtime writes: sessions and workflow plans. */
export const KERNEL_TYPES = ["agent-session", "agent-workflow"]

/**
 * The built-in tools a research step gets, and only these. A plugin joins
 * them only by declaring `scoped: true` (`admitScoped`, below): a plugin is
 * someone else's code, and a step fetches anything without asking, so a
 * plugin is never there by default.
 */
export const SCOPED_TOOL_IDS = ["web_search", "web_fetch", "http_request", "source_read", "source_list", "finding_write", "session_recall", "workflow_request"]

export const NOT_A_SOURCE = "Not one of this workflow's sources."
export const EDITED_OUTSIDE = "This finding changed outside the research steps; write a new one."
export const KERNEL_REFUSAL = "Sessions and workflow plans are written only by the agent runtime; no tool may change one."

/** Why a session will not run: its scope is malformed, or disagrees with its plan. */
export class ScopeRefusal extends Error {}

const isKernel = (doc) => KERNEL_TYPES.includes(doc?.["@patchwork"]?.type)

/** The canonical id of anything that names a document, or null. */
function idOf(name) {
  try {
    return interpretAsDocumentId(String(name ?? "").trim())
  } catch {
    return null
  }
}

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
    stringifyAutomergeUrl({ documentId: idOf(ledger) }) === ledger &&
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
      const id = idOf(name)
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

/** Does this plugin metadata declare a tool a research step may have? Scoped as exactly true, and a worker tool. */
const declaresScoped = (meta) => meta?.scoped === true && (meta.where ?? "worker") === "worker"

export const UNDECLARED_MID_RUN = "This plugin was registered again during the run without declaring `scoped: true`; a research step cannot run it."

/**
 * The plugin tools a research step may have, out of `plugins` — what this
 * runner's own registry loaded (tools/index.js loadPluginTools). Only a
 * plugin that declares `scoped: true` at the top level of its metadata, a
 * worker-tier tool, whose id is no built-in's: the declaration is the
 * package's word that its tool works only through the context it is handed,
 * and that context is the step's confined one (`confine`) and nothing more.
 * The first of two plugins with one id wins, as nothing else would be
 * certain to.
 *
 * The declaration is checked again at every call, on the plugin about to
 * run: the registry holds one plugin per id, and any package may register
 * an id again during a run, which replaces what was admitted. What runs is
 * then the new plugin, and only if it too declares.
 *
 * Installing a package that makes the declaration extends what research
 * steps can do: that is the trust it asks for, and the README says so.
 */
export async function admitScoped(plugins = []) {
  const { BUILTIN_TOOLS } = await import("./tools/index.js")
  const taken = new Set(BUILTIN_TOOLS.map((t) => t.id))
  const admitted = []
  for (const tool of plugins ?? []) {
    if (!declaresScoped(tool) || tool.where !== "worker" || typeof tool.current !== "function") continue
    if (typeof tool.id !== "string" || taken.has(tool.id)) continue
    taken.add(tool.id)
    admitted.push(
      Object.freeze({
        ...tool,
        async execute(input, ctx) {
          const now = await tool.current()
          if (!declaresScoped(now)) throw new ScopeRefusal(UNDECLARED_MID_RUN)
          return now.module.execute(input, ctx)
        },
      })
    )
  }
  return admitted
}

/**
 * The toolset of a research step: exactly SCOPED_TOOL_IDS, each the built-in
 * itself or its scoped variant, then the plugins `admitScoped` admits out of
 * `plugins`; frozen. Whatever the session says about its tools is not
 * consulted — it is not the session's to say.
 *
 * Loaded late: the tool registry imports the workflow driver, which imports
 * the runner, which imports this.
 */
export async function scopedToolset({ plugins = [] } = {}) {
  const { BUILTIN_TOOLS, SCOPED_VARIANTS, UNSCOPED_ONLY_IDS, toSchema } = await import("./tools/index.js")
  const byId = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]))
  const builtins = SCOPED_TOOL_IDS.filter((id) => !UNSCOPED_ONLY_IDS.includes(id)).map((id) => SCOPED_VARIANTS[id] ?? byId.get(id))
  if (builtins.some((t) => !t)) throw new Error("A research step's tool is missing from the registry.")
  const frozen = Object.freeze([...builtins, ...(await admitScoped(plugins))])
  const index = new Map(frozen.map((t) => [t.id, t]))
  return Object.freeze({ tools: frozen, schemas: frozen.map(toSchema), get: (id) => index.get(id) ?? null })
}

// ------------------------------------------------------------ kernelRepo

/** Handle methods that hand back another handle on the same document. */
const DERIVES = new Set(["view", "sub"])
/** Handle methods that take a listener, which must be handed the guarded handle, not the one beneath. */
const LISTENS = new Set(["on", "once", "addListener", "off", "removeListener"])

/** The whole document behind a handle, whatever path it is scoped to. */
const whole = (handle) => (typeof handle.fullDoc === "function" ? handle.fullDoc() : handle.doc())

const refuse = () => {
  throw new Error(KERNEL_REFUSAL)
}

/**
 * Each guarded handle, by the handle beneath it, and back: one guard per handle
 * for each session's record of its writes (or none), so a listener comes off
 * the way it went on and a write is credited to the session that made it.
 */
const guardsByRecord = new WeakMap() // record -> WeakMap(handle -> guard)
const unrecorded = new WeakMap()
const guardsFor = (record) => {
  if (!record) return unrecorded
  if (!guardsByRecord.has(record)) guardsByRecord.set(record, new WeakMap())
  return guardsByRecord.get(record)
}
const beneath = new WeakMap()
const unguarded = (value) => beneath.get(value) ?? value

/**
 * A write through a sub-handle changes only what is at its path, so it can
 * make a document a session or a plan only from inside `@patchwork`. One
 * whose path starts anywhere else is left to the document as it is; one that
 * starts there, or at a path that does not resolve, is refused.
 */
function judgePath(handle) {
  const first = handle.path?.[0]
  if (!first || first.prop === undefined || first.prop === "@patchwork") refuse()
}

const isSub = (handle) => (handle.path?.length ?? 0) > 0 || !!handle.range

/**
 * A whole-document write, done to a copy and kept only if the copy is still
 * not a session or a plan. Through `update`, which adopts what its callback
 * returns and keeps the document as it was if the callback throws: the
 * document the handle holds is never touched by a write that is refused.
 * Copied under the same actor, so a write that is kept reads as this peer's.
 */
function judgedWrite(handle, write) {
  let result
  handle.update((doc) => {
    const after = write(A.clone(doc, { actor: A.getActorId(doc) }))
    if (isKernel(after.doc)) refuse()
    result = after.result
    return after.doc
  })
  return result
}

/**
 * How each write is done through a guarded handle, after the document as it
 * is has been judged. Every one judges what the document will be, too: a plan
 * a tool could make would pass for a real one, and the driver would run its
 * research steps against a ledger the tool wrote.
 */
const WRITES = {
  change(handle, write, [fn, options]) {
    if (isSub(handle)) {
      judgePath(handle)
      return write.call(handle, fn, options)
    }
    // A root change's draft is the document as the change leaves it, and a
    // throw inside the change abandons it — cheaply, so the common write is
    // not copied.
    const checked = (d) => {
      fn(d)
      if (isKernel(d)) refuse()
    }
    return write.call(handle, typeof fn === "function" ? checked : fn, options)
  },
  changeAt(handle, write, [heads, fn, options = {}]) {
    if (isSub(handle)) {
      judgePath(handle)
      return write.call(handle, heads, fn, options)
    }
    // The draft is the document at `heads`; what it becomes is that merged
    // with everything since, which only the result shows.
    return judgedWrite(handle, (doc) => {
      const { newDoc, newHeads } = A.changeAt(doc, decodeHeads(heads), options, fn)
      return { doc: newDoc, result: newHeads ? encodeHeads(newHeads) : undefined }
    })
  },
  merge(handle, _write, [other]) {
    return judgedWrite(handle, (doc) => ({ doc: A.merge(doc, unguarded(other).fullDoc()) }))
  },
  update(handle, _write, [fn]) {
    return judgedWrite(handle, (doc) => ({ doc: fn(doc) }))
  },
  remove(handle, write) {
    judgePath(handle)
    return write.call(handle)
  },
  delete(handle, write) {
    return write.call(handle)
  },
}

/** The heads of the whole document behind a handle, or null if it has none now (deleted). */
const headsOf = (handle) => {
  try {
    return A.getHeads(whole(handle))
  } catch {
    return null
  }
}

function kernelHandle(handle, record = null) {
  if (!handle || typeof handle !== "object") return handle
  if (beneath.has(handle)) return handle
  const guards = guardsFor(record)
  if (guards.has(handle)) return guards.get(handle)

  // A listener is called with the handle it was added to; it gets this one.
  const listeners = new WeakMap()
  const listenerFor = (fn) => {
    if (typeof fn !== "function") return fn
    if (!listeners.has(fn)) listeners.set(fn, (payload) => fn(payload?.handle ? { ...payload, handle: kernelHandle(payload.handle, record) } : payload))
    return listeners.get(fn)
  }
  // The chainable methods return the handle itself; they return this one.
  const ours = (result) => (result === handle ? guard : result)

  const guard = new Proxy(handle, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== "function") return value
      if (Object.hasOwn(WRITES, key)) {
        return (...args) => {
          // Judged at the moment of writing and on the whole document, so
          // neither a path in the URL nor a document that became a session
          // after it was opened gets past it.
          if (isKernel(whole(target))) refuse()
          // The changes this write made, for the session that made it
          // (own-changes.js): the heads it added. Writes are synchronous, so
          // nothing else lands in between.
          const before = record ? headsOf(target) : null
          const result = WRITES[key](target, value, args)
          if (record) record(addedHeads(before, headsOf(target)))
          return result
        }
      }
      if (DERIVES.has(key)) return (...args) => kernelHandle(value.apply(target, args), record)
      if (LISTENS.has(key)) return (event, fn) => ours(value.call(target, event, listenerFor(fn)))
      // Bound to the handle itself: its fields are private, and a method
      // called on the proxy could not reach them. A guarded handle passed
      // back in is unwrapped for the same reason.
      return (...args) => ours(value.apply(target, args.map(unguarded)))
    },
  })
  guards.set(handle, guard)
  beneath.set(guard, handle)
  return guard
}

const wrapped = (result, record) =>
  result && typeof result.then === "function" ? result.then((h) => kernelHandle(h, record)) : kernelHandle(result, record)

/**
 * The repo every other session's tools get: everything works, except that no
 * handle it gives out can change a session or a plan, however its id was
 * spelled, or make a document into one; and it makes none itself — not from
 * an initial value, a copy of one, or bytes. The repo's own ways around a
 * handle — its table of live handles, deleting by id, importing over an
 * existing id — are closed too.
 */
export function kernelRepo(repo, { known = null, record = null } = {}) {
  if (!repo || typeof repo !== "object") return repo
  // A mistyped document URL is mended where that is safe, or refused with
  // the nearest the conversation has seen (doc-urls.js).
  const mend = (args) => (args.length ? [repairDocUrl(args[0], known ?? []).url, ...args.slice(1)] : args)
  return new Proxy(repo, {
    get(target, key) {
      if (key === "handles" || key === "findWithProgress") return undefined
      const value = Reflect.get(target, key)
      if (typeof value !== "function") return value
      if (key === "find" || key === "findClassic") return (...args) => wrapped(value.apply(target, mend(args)), record)
      if (key === "create" || key === "create2") {
        return (initial) => {
          if (isKernel(initial)) refuse()
          return wrapped(value.call(target, initial), record)
        }
      }
      if (key === "clone") {
        return (source) => {
          const original = unguarded(source)
          if (isKernel(whole(original))) refuse()
          return kernelHandle(value.call(target, original), record)
        }
      }
      if (key === "delete") {
        return (name) => {
          const live = target.handles?.[idOf(name)]
          // A document this repo has not loaded cannot be judged, so it is not deleted.
          if (!live || isKernel(whole(live))) refuse()
          return value.call(target, name)
        }
      }
      if (key === "import") {
        return (binary, args) => {
          if (args?.docId) refuse()
          if (isKernel(A.load(binary))) refuse()
          return kernelHandle(value.call(target, binary, args), record)
        }
      }
      return value.bind(target)
    },
  })
}
