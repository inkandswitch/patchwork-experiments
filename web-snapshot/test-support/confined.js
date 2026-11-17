/**
 * A research step's context, as the agent builds it — restated here for the
 * tests, because this package must not import the agent.
 *
 * The agent hands a plugin that declares `scoped: true` exactly what it
 * hands its own research tools (agent/scope.js `confine`): the call's signal
 * and events, whether it runs in node, the reader, the runner's guarded
 * fetch, a repo whose only read capability is membership in the workflow's
 * ledger (`scopedRepo`), and the step's id. Nothing that names any other
 * document. This copy follows that module rule for rule, so web_capture can
 * be driven here the way a research step drives it, and everything it asks
 * of its context recorded.
 */

import { interpretAsDocumentId, stringifyAutomergeUrl } from "@automerge/automerge-repo"
import { readable } from "../keep.js"

export const NOT_A_SOURCE = "Not one of this workflow's sources."
export const EDITED_OUTSIDE = "This finding changed outside the research steps; write a new one."

/** The fields of a confined context, and only these (agent/scope.js `confine`). */
export const CONFINED_KEYS = ["direct", "events", "fetchImpl", "reader", "repo", "scope", "signal"]

function idOf(name) {
  try {
    return interpretAsDocumentId(String(name ?? "").trim())
  } catch {
    return null
  }
}

function sameHeads(a, b) {
  const left = new Set(a ?? [])
  const right = new Set(b ?? [])
  return left.size === right.size && [...left].every((h) => right.has(h))
}

/** What a kept document is, for the ledger: a finding, a document of a package's own datatype by that type, or a kind of file. */
function whatOf(doc) {
  if (doc?.role === "finding") return "finding"
  const type = doc?.["@patchwork"]?.type
  if (type && type !== "file") return type
  if (doc?.role === "extract") return "extract"
  if (doc?.mimeType === "application/pdf") return "pdf"
  return "file"
}

/** agent/scope.js `scopedRepo`: find by ledger membership, create2 into the ledger, sources() the ledger. */
export function scopedRepo(repo, ledger, { stepId }) {
  const entry = (id) => ledger.doc()?.sources?.[id] ?? null
  const required = (id) => {
    const found = entry(id)
    if (!found) throw new Error(NOT_A_SOURCE)
    return found
  }
  const read = (handle, id) => {
    const { heads } = required(id)
    return sameHeads(handle.heads(), heads) ? handle.doc() : handle.view([...heads]).doc()
  }
  const describe = (id, handle) => {
    const doc = handle.doc()
    const text = readable(doc)
    const facts = {
      what: whatOf(doc),
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
  const readOnly = (handle, id, url) => Object.freeze({ url, documentId: id, doc: () => read(handle, id), heads: () => [...required(id).heads] })
  const writable = (handle, id, url) =>
    Object.freeze({
      url,
      documentId: id,
      doc: () => read(handle, id),
      heads: () => [...required(id).heads],
      change(fn) {
        if (!sameHeads(handle.heads(), required(id).heads)) throw new Error(EDITED_OUTSIDE)
        handle.change(fn)
        describe(id, handle)
      },
    })
  return Object.freeze({
    async find(name) {
      const id = idOf(name)
      if (!id) throw new Error(NOT_A_SOURCE)
      const e = required(id)
      const handle = await repo.find(stringifyAutomergeUrl({ documentId: id }))
      return e.kind === "finding" ? writable(handle, id, e.url) : readOnly(handle, id, e.url)
    },
    async create2() {
      const handle = await repo.create2()
      const id = handle.documentId
      ledger.change((d) => {
        if (!d.sources) d.sources = {}
        d.sources[id] = { url: handle.url, kind: "source", what: null, type: null, source: null, name: null, engine: null, chars: null, by: stepId, at: Date.now(), heads: [...handle.heads()] }
      })
      return writable(handle, id, handle.url)
    },
    sources() {
      return Object.entries(ledger.doc()?.sources ?? {})
        .filter(([, e]) => e?.what != null)
        .map(([id, e]) => ({ id, url: e.url, kind: e.kind, what: e.what, type: e.type ?? null, source: e.source ?? null, name: e.name ?? null, engine: e.engine ?? null, chars: e.chars ?? null, by: e.by ?? null, at: e.at ?? 0 }))
        .sort((a, b) => b.at - a.at)
    },
  })
}

/** agent/scope.js `confine`: built field by field from the allowlist, never filtered from the runner's context. */
export async function confine(ctx, scope) {
  const ledger = await ctx.repo.find(scope.ledgerUrl)
  return {
    signal: ctx.signal,
    events: ctx.events,
    direct: ctx.direct,
    reader: ctx.reader,
    fetchImpl: ctx.fetchImpl,
    repo: scopedRepo(ctx.repo, ledger, scope),
    scope: { stepId: scope.stepId },
  }
}
