/**
 * The folder check and model runs, shared by the view and the agent tools so
 * a person and the agent do exactly the same thing.
 *
 * checkFolder   scan the task folder and every document a model run read,
 *               save the scan, write every result back. The view's "Check
 *               the folder" button and its rescan on open call it, and so
 *               does assumptions_check.
 * runsToRead    model results to read from their documents. A notebook that
 *               prints "id value" lines gives its results; when its outputs
 *               change (it was run), the check records the run itself: the
 *               printed value, the document's heads and code, and as inputs
 *               the values its own code assigns (what it ran with). Nobody
 *               copies a result by hand. A linked notebook's run record
 *               (metadata.patchwork.run, from jupyter-linked) says more: only
 *               a run that finished well counts, and its inputs are the
 *               register's entries at the heads the run read them.
 * runRecord     what a model run records about the documents it read: each
 *               one's heads and code fingerprint, and when. For a model that
 *               prints nothing, a person records a run from the panel, the
 *               agent with assumptions_set.
 *
 * A run is stale when an input moved beyond its tolerance or when the code
 * of a document it read no longer has the fingerprint it ran with (see
 * evaluate in register.js). Re-running is manual for now, by a person or the
 * agent; the register only says what is out of date.
 *
 * Sources the same way: every claim records the version of its kept source
 * its quote was found in (`seen`). When the source's fingerprint moves, the
 * check looks for the quote again, since that needs no judgement: found, the
 * claim is checked against the new version; gone, the claim is no longer
 * verified and says so (`lost`), until the quote is back or the claim changes.
 */

import { locate, quoteIn } from "./quote.js"
import { evaluate, materialize } from "./register.js"
import { observedUse } from "./uses.js"
import { plainValue } from "./values.js"
import { codeOf, limiter, openWithin, scanFolder, sourceFingerprint, sourceText, stopped } from "./where.js"

const CONCURRENCY = 8

export const headsOf = (handle) => (typeof handle?.heads === "function" ? [...(handle.heads() ?? [])] : [])
export const plain = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))

/** JSON with keys in order, so a record read back from Automerge (keys sorted) equals the one it was written from. */
export function canonical(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v))
}
const strip = (url) => String(url).split("#")[0]

/** Save a scan, rewriting only the documents whose record changed. Inside a change. */
export function writeScan(d, scan) {
  if (!d.scan) {
    d.scan = plain(scan)
    return
  }
  for (const key of ["at", "time", "idsKey", "unopened", "read", "reused", "truncated", "folder"]) {
    if (canonical(d.scan[key] ?? null) !== canonical(scan[key] ?? null)) d.scan[key] = plain(scan[key] ?? null)
  }
  for (const part of ["docs", "sources"]) {
    const want = scan[part] ?? {}
    if (!d.scan[part]) d.scan[part] = {}
    for (const url of Object.keys(d.scan[part])) if (!(url in want)) delete d.scan[part][url]
    for (const [url, record] of Object.entries(want)) {
      if (canonical(d.scan[part][url] ?? null) !== canonical(record)) d.scan[part][url] = plain(record)
    }
  }
}

const kept = (url) => /^automerge:/.test(String(url ?? ""))

/** A kept source as it is now: its text and the version it was read at, or null if it can't be opened. */
export async function readSource(repo, url) {
  if (!kept(url) || !repo) return null
  try {
    const handle = await repo.find(String(url))
    const doc = handle.doc()
    if (!doc) return null
    const heads = headsOf(handle)
    return { text: sourceText(doc), seen: { heads, text: sourceFingerprint(doc, heads) }, title: doc.title || doc.name || null }
  } catch {
    return null
  }
}

/** Every kept source a claim with a quote cites. */
export function claimSources(entries) {
  const out = new Set()
  for (const entry of Object.values(entries ?? {})) for (const c of entry?.claims ?? []) if (c.quote && kept(c.source)) out.add(String(c.source))
  return [...out].sort()
}

/**
 * Read every cited source (reusing the fingerprint of any whose heads haven't
 * moved) and say which claims need their quote looked for again. Returns
 * { sources: { [url]: { heads, text, path } | { missing: true } }, rechecks: [{ id, key, set }] }.
 */
async function recheckSources(repo, entries, previous, { signal = null, onProgress = null, timeout } = {}) {
  const sources = {}
  const texts = new Map()
  const handles = new Map()
  const urls = claimSources(entries)
  const limit = limiter(CONCURRENCY)
  let done = 0
  onProgress?.({ phase: "sources", done, total: urls.length })
  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        let handle
        try {
          handle = await openWithin((u) => repo.find(u), url, { ms: timeout, signal })
          if (!handle.doc()) throw new Error("empty")
        } catch (error) {
          if (error?.name === "AbortError") throw error
          sources[url] = { missing: true }
          return
        } finally {
          done++
          onProgress?.({ phase: "sources", done, total: urls.length })
        }
        handles.set(url, handle)
        const heads = headsOf(handle)
        const before = previous?.[url]
        const doc = handle.doc()
        sources[url] = before?.text && heads.length && JSON.stringify(before.heads) === JSON.stringify(heads) ? before : { heads, text: sourceFingerprint(doc, heads), path: doc.title || doc.name || null }
      }),
    ),
  )
  if (signal?.aborted) throw stopped()
  const textOf = (url) => {
    if (!texts.has(url)) texts.set(url, sourceText(handles.get(url).doc()))
    return texts.get(url)
  }
  const rechecks = []
  for (const [id, entry] of Object.entries(entries ?? {})) {
    for (const c of entry?.claims ?? []) {
      if (!c.quote || !kept(c.source)) continue
      const now = sources[String(c.source)]
      if (now.missing) {
        if (c.lost !== "unavailable") rechecks.push({ id, key: c.key, set: { lost: "unavailable" } })
        continue
      }
      if (c.seen?.text === now.text && c.lost !== "unavailable") continue
      const seen = { heads: now.heads, text: now.text }
      const where = quoteIn(textOf(String(c.source)), c.quote) ? locate(textOf(String(c.source)), c.quote) : null
      const set = where ? { seen, lost: null, verified: true, section: where.section ?? null, context: where.context ?? null } : { seen, lost: "missing", verified: false }
      rechecks.push({ id, key: c.key, set })
    }
  }
  return { sources, rechecks }
}

/** Re-evaluate and write every entry's results back. Inside a change. */
export function settle(d, at) {
  const evaluation = evaluate(d)
  materialize(d, evaluation, { at })
  return evaluation
}

/** Every document a model result comes from or its run read. */
export function runDocuments(entries) {
  const out = new Set()
  for (const entry of Object.values(entries ?? {})) {
    if (entry?.basis !== "model") continue
    for (const url of Object.keys(entry.model?.ran ?? {})) out.add(url)
    if (kept(entry.model?.url)) out.add(strip(entry.model.url))
  }
  return [...out].sort()
}

/** What a run read for an input: the values the document's own code assigns it, over the register's now. */
function ranWith(input, record, now) {
  const assigned = {}
  for (const a of record.assigns ?? []) {
    if (a.name === input) assigned.nominal = a.value
    else if (a.name === `${input}_min`) assigned.min = a.value
    else if (a.name === `${input}_max`) assigned.max = a.value
  }
  const base = plainValue(now ?? null)
  if (!Object.keys(assigned).length) return base
  return { ...(base && typeof base === "object" ? base : {}), ...assigned }
}

/**
 * The register as a run read it, from a linked notebook's run record: for
 * each entry the run read, the heads it read the register at. An import of
 * the register (bound as a module) or a read of the whole document reads
 * every entry; a read with paths reads the entries they name — `[id, …]`
 * against the json view, `["entries", id, …]` against the raw document. The
 * first access that reads an entry wins. Map<id | "*", heads>.
 */
export function registerReads(run, registerUrl) {
  const out = new Map()
  if (!run || !registerUrl) return out
  const mine = (url) => strip(url) === strip(registerUrl)
  const put = (key, heads) => {
    if (heads?.length && !out.has(key)) out.set(key, heads)
  }
  for (const i of run.imports ?? []) if (mine(i.docUrl) && i.as !== "missing") put("*", i.heads)
  for (const r of run.reads ?? []) {
    if (!mine(r.docUrl)) continue
    if (!r.paths || r.paths.some((p) => p.length === 0)) put("*", r.heads)
    for (const p of r.paths ?? []) {
      const id = r.as === "json" ? p[0] : p[0] === "entries" ? p[1] : null
      if (id) put(id, r.heads)
    }
  }
  return out
}

/**
 * Model results whose document has new outputs giving them: [{ id, url,
 * value, was, model }] where `model` is the entry's new model record. Pure:
 * reads the register and a scan, changes nothing. `registerAt(heads)` gives
 * the register's entries at earlier heads, for a run record that says which
 * version of the register the run read.
 */
export function runsToRead(doc, scan, evaluation = evaluate(doc), { registerUrl = null, registerAt = null } = {}) {
  const out = []
  // What each document's new outputs give: a result the same run gave is what
  // another result of that run read, whatever the register held before. Only
  // that document's own results count: a run that prints an input for show
  // (pack_parallel = 4) hasn't computed it.
  const resultOf = (url, id) => {
    const e = doc?.entries?.[id]
    return e?.basis === "model" && ((kept(e.model?.url) && strip(e.model.url) === url) || url in (e.model?.ran ?? {}))
  }
  const given = new Map()
  for (const [url, record] of Object.entries(scan?.docs ?? {})) for (const o of record.outputs ?? []) if (resultOf(url, o.id)) given.set(`${url}|${o.id}`, o.value)
  for (const [id, entry] of Object.entries(doc?.entries ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (entry.basis !== "model") continue
    const urls = [...new Set([kept(entry.model?.url) ? strip(entry.model.url) : null, ...Object.keys(entry.model?.ran ?? {})].filter(Boolean))]
    for (const url of urls) {
      const record = scan?.docs?.[url]
      const mine = record?.outputs?.find((o) => o.id === id)
      if (!mine || record.missing) continue
      if (entry.model?.ran?.[url]?.runKey === record.runKey) break
      // A notebook still running is writing its outputs: read nothing yet. A run
      // record that describes these outputs is trusted only when the run
      // finished well; one about other outputs (run since by other means) is
      // set aside, and the outputs are read as any notebook's are.
      if (record.run?.status === "running") break
      const run = record.run && record.run.outputs === record.runKey ? record.run : null
      if (run && (run.status !== "ok" || !run.finished)) break
      const read = registerReads(run, registerUrl)
      const ran = {}
      for (const other of Object.keys(entry.model?.ran ?? {})) {
        const r = scan.docs?.[other]
        ran[other] = r && !r.missing ? { heads: r.heads, code: r.code, runKey: r.runKey ?? null } : entry.model.ran[other]
      }
      // The code the run had: for a document that keeps its run, as of that run's heads.
      ran[url] = { heads: record.heads, code: record.runCode ?? record.code, runKey: record.runKey }
      // What the run read for each input: the same run's own result; else the
      // register as the run record says it read it; else what the code assigns,
      // over the register now.
      const atHeads = (input) => {
        const heads = read.get(input) ?? read.get("*")
        if (!heads || !registerAt) return undefined
        const then = registerAt(heads)
        return then ? plainValue(then[input]?.value ?? null) : undefined
      }
      const inputs = Object.fromEntries(
        Object.keys(entry.model?.inputs ?? {}).map((input) => {
          if (given.has(`${url}|${input}`)) return [input, plainValue(given.get(`${url}|${input}`))]
          const then = atHeads(input)
          return [input, then !== undefined ? then : ranWith(input, record, evaluation.byId.get(input)?.value)]
        }),
      )
      const by = { kind: "document", url, line: `${mine.part}:${mine.line}`, ...(run?.by ? { runBy: run.by } : {}) }
      out.push({ id, url, path: record.path, value: mine.value, was: entry.model?.value ?? null, model: { ...plain(entry.model), value: mine.value, ran, ranAt: scan.time, inputs, by } })
      break
    }
  }
  return out
}

/** Whether a rescan says anything the saved one doesn't: a document changed, or a run is newer than the saved scan. */
function worthSaving(previous, scan, entries) {
  if (!previous) return true
  if (Boolean(previous.truncated) !== Boolean(scan.truncated)) return true
  if (canonical(previous.unopened ?? []) !== canonical(scan.unopened ?? [])) return true
  const before = Object.keys(previous.docs ?? {})
  if (before.length !== Object.keys(scan.docs).length) return true
  // A document whose heads moved but whose uses, code, outputs and run are the
  // same says nothing new: saving it anyway would make a model that imports
  // this register (and re-renders on every change to it) and the register
  // answer each other forever.
  const said = (record) => (record ? canonical({ ...record, heads: undefined }) : "null")
  for (const [url, record] of Object.entries(scan.docs)) if (said(previous.docs?.[url]) !== said(record)) return true
  return Object.values(entries ?? {}).some((e) => e?.basis === "model" && e.model?.ranAt && !(previous.time >= e.model.ranAt))
}

/**
 * Scan and save. `quiet` (the view's rescan on open) writes nothing when the
 * rescan found nothing new, so opening a register doesn't add a change.
 * `onProgress` hears each document and source as it opens; `signal` stops
 * the check, and a stopped check writes nothing. Returns { scan, saved,
 * stopped }; scan is null when there is nothing to scan.
 */
export async function checkFolder(handle, repo, { folderUrl = null, message = "check", quiet = false, signal = null, onProgress = null, timeout } = {}) {
  const doc = handle.doc() ?? {}
  const folder = folderUrl || doc.scope || null
  const also = runDocuments(doc.entries)
  if (!folder && !also.length && !claimSources(doc.entries).length) return { scan: null, saved: false, stopped: false, runs: [] }
  let scan, sources, rechecks
  try {
    scan = await scanFolder(repo, { entries: doc.entries ?? {}, registerUrl: handle.url, folderUrl: folder, also, previous: doc.scan ?? null, at: headsOf(handle), signal, onProgress, ...(timeout ? { timeout } : {}) })
    ;({ sources, rechecks } = await recheckSources(repo, doc.entries, doc.scan?.sources, { signal, onProgress, ...(timeout ? { timeout } : {}) }))
  } catch (error) {
    if (error?.name === "AbortError") return { scan: null, saved: false, stopped: true, runs: [] }
    throw error
  }
  if (signal?.aborted) return { scan: null, saved: false, stopped: true, runs: [] }
  scan.sources = sources
  const sourcesMoved = canonical(sources) !== canonical(doc.scan?.sources ?? {})
  // The register at the heads a run record says the run read it at (cached per heads).
  const views = new Map()
  const registerAt = (heads) => {
    const key = [...heads].sort().join(",")
    if (!views.has(key)) {
      try {
        views.set(key, typeof handle.view === "function" ? plain(handle.view([...heads]).doc()?.entries ?? null) : null)
      } catch {
        views.set(key, null)
      }
    }
    return views.get(key)
  }
  const runs = runsToRead(doc, scan, evaluate(doc), { registerUrl: handle.url, registerAt })
  if (quiet && !runs.length && !rechecks.length && !sourcesMoved && !worthSaving(doc.scan, scan, doc.entries)) return { scan, saved: false, stopped: false, runs }
  handle.change(
    (d) => {
      writeScan(d, scan)
      for (const run of runs) if (d.entries?.[run.id]?.basis === "model") d.entries[run.id].model = plain(run.model)
      for (const { id, key, set } of rechecks) {
        const claim = (d.entries?.[id]?.claims ?? []).find((c) => c.key === key)
        if (claim) for (const [field, value] of Object.entries(set)) claim[field] = plain(value)
      }
      const evaluation = settle(d, headsOf(handle))
      // A reference entry a model now reads: the mark is outdated, so correct it quietly.
      for (const [id, entry] of Object.entries(d.entries ?? {})) {
        if (entry.use?.intent === "reference" && observedUse(id, entry, evaluation.readers, d.scan) === "model") entry.use.intent = "model"
      }
    },
    { message: `${typeof message === "function" ? message(scan) : message}${runs.length ? `; read ${runs.length} model result${runs.length === 1 ? "" : "s"} from ${[...new Set(runs.map((r) => r.path || "a model"))].join(", ")}` : ""}` },
  )
  return { scan, saved: true, stopped: false, runs }
}

/**
 * What a run records about the documents it read: { ran: { [url]: { heads,
 * code } }, ranAt }. A URL pinned to heads (automerge:…#heads) is the version
 * the run used; an unpinned one is the document as it is now. Throws, naming
 * the document, when one can't be opened.
 */
export async function runRecord(repo, urls) {
  const ran = {}
  for (const url of urls) {
    let handle
    try {
      handle = await openWithin((u) => repo.find(u), String(url))
    } catch (error) {
      throw new Error(`couldn't open ${url}, which the run read (${error.message})`)
    }
    const heads = headsOf(handle)
    ran[strip(url)] = { heads, code: codeOf(handle.doc(), heads) }
  }
  return { ran, ranAt: new Date().toISOString() }
}

/** Record a model entry's inputs as they are now. On a plain entry or inside a change. */
export function recordInputs(entry, evaluation) {
  for (const input of Object.keys(entry.model?.inputs ?? {})) entry.model.inputs[input] = plainValue(evaluation.byId.get(input)?.value ?? null)
}
