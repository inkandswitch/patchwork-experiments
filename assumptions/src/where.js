/**
 * Where a register's entries are used outside it: walk the folder it serves,
 * read each document's text, and find every entry id in it — plus the
 * constants model code writes down itself instead of reading from the register.
 *
 * What counts as text, by datatype:
 *
 *   jupyter-notebook   each cell's source ("cell 3"); code cells are code
 *   openscad           `source`, code
 *   file / markdown    `content`; code when the extension is a code one
 *   datagrid           its cells, as one line per row
 *
 * A use in code is a *model* use (it computes with the value); a use anywhere
 * else is *prose*. Left out: registers, kept sources (a datasheet does not
 * "use" an id), and exports of a register, which name every entry by
 * construction and are listed separately.
 *
 * The scan is saved in the register with the heads of every document it
 * read, so everyone sees it without rescanning, and a rescan reads only the
 * documents whose heads have moved (or all of them, if the register's ids
 * have changed since).
 *
 * It also reads the documents model runs read, wherever they are, and keeps
 * each one's code fingerprint (codeOf): a run whose fingerprint no longer
 * matches is stale.
 */

import { GENERATED_MARK, exportedNames } from "./export.js"
import { isNumeric, parseValue } from "./values.js"

const CODE_EXTENSIONS = new Set(["py", "scad", "js", "mjs", "ts", "jl", "m", "r"])
const MAX_DOCS = 400
const MAX_DEPTH = 8
const CONCURRENCY = 8
const OPEN_TIMEOUT_MS = 15000

function textOf(content) {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return new TextDecoder("utf-8", { fatal: false }).decode(content)
  const text = String(content)
  return text === "[object Object]" ? "" : text
}

function cellSource(cell) {
  return Array.isArray(cell?.source) ? cell.source.map((v) => (typeof v === "string" ? v : typeof v?.val === "string" ? v.val : textOf(v))).join("") : typeof cell?.source?.val === "string" ? cell.source.val : textOf(cell?.source)
}

/** The readable parts of one document: [{ part, text, code }]. Empty for what is not read. */
export function partsOf(doc, name = "") {
  if (!doc || typeof doc !== "object") return []
  const type = doc["@patchwork"]?.type
  if (type === "web-snapshot" || doc.capture != null) return []
  if (Array.isArray(doc.cells)) {
    return doc.cells.map((cell, i) => ({ part: `cell ${i + 1}`, text: cellSource(cell), code: str(cell?.cell_type) === "code" }))
  }
  if (type === "openscad" || (typeof doc.source === "string" && !doc.content)) {
    return [{ part: "", text: textOf(doc.source), code: true }]
  }
  if (doc.content != null) {
    const extension = String(doc.extension ?? String(doc.name ?? name).split(".").at(-1) ?? "").toLowerCase()
    return [{ part: "", text: textOf(doc.content), code: CODE_EXTENSIONS.has(extension) }]
  }
  if (type === "datagrid" && doc.data) {
    const rows = Array.isArray(doc.data) ? doc.data : Object.values(doc.data)
    return [{ part: "", text: rows.map((row) => (Array.isArray(row) ? row.join(" | ") : JSON.stringify(row))).join("\n"), code: false }]
  }
  return []
}

/** A short, stable hash of a string (cyrb53), as hex. */
function hash(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * What a model run rests on in a document, as a fingerprint: its code (a
 * notebook's code cells, an OpenSCAD source, a code file); all its text when
 * it has no code (a case file, a table); its heads when it has no text
 * either. Conservative: any change to the code counts, comments and
 * whitespace included. A notebook's outputs and prose cells don't count,
 * since running it rewrites them.
 */
export function codeOf(doc, heads = []) {
  const parts = partsOf(doc)
  const code = parts.filter((p) => p.code)
  const texts = (code.length ? code : parts).map((p) => p.text)
  if (texts.some((t) => t.trim())) return `t:${hash(texts.join("\n\u0000\n"))}`
  return `h:${[...heads].sort().join(",")}`
}

/** Everything readable in a kept source: the parts any model reads, plus a capture's extracted text. */
export function sourceText(doc) {
  const parts = partsOf({ ...doc, capture: null }).map((p) => p.text)
  for (const key of ["text", "content", "markdown"]) if (typeof doc?.[key] === "string" && !parts.includes(doc[key])) parts.push(doc[key])
  return parts.join("\n")
}

const ID_LINE = /^\s*([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\s*(?:[:=]\s*|\s+)(\S.*?)\s*$/

/** A string as Automerge may hold it: plain, or an ImmutableString. */
const str = (v) => (v == null ? "" : typeof v === "string" ? v : typeof v.val === "string" ? v.val : textOf(v))
const joined = (v) => (Array.isArray(v) ? v.map(str).join("") : str(v))

function outputText(out) {
  if (str(out?.output_type) === "stream") return joined(out.text)
  return joined(out?.data?.["text/plain"])
}

/** An OpenSCAD console line as a plain one: `ECHO: "id", 42` and `ECHO: id = 42` read as "id 42". */
const consoleLine = (line) =>
  String(line)
    .replace(/^\s*ECHO:\s*/, "")
    .replace(/^"([^"]*)"\s*,\s*/, "$1 ")
    .replace(/^"(.*)"$/, "$1")

/**
 * The results a model document gave in its last run: lines that start with an
 * entry's id and give a figure — "id 28.17", "id = 28.17 kW", "id: 42
 * (40–44)". The last such line for an id wins. A notebook's are in its code
 * cells' outputs; a document that keeps its last run (`lastRun: { ok, logs,
 * heads }`, as OpenSCAD does) in that run's console, where `echo(id = 42)`
 * counts. A failed run gives nothing.
 * Returns [{ id, value, part, line, text }].
 */
export function outputsOf(doc, ids) {
  const found = new Map()
  const take = (line, part, j) => {
    const m = line.match(ID_LINE)
    if (!m || !ids.has(m[1])) return
    const parsed = parseValue(m[2])
    if (parsed.problem || !isNumeric(parsed.value)) return
    found.set(m[1], { id: m[1], value: parsed.value, part, line: j + 1, text: line.trim().slice(0, 160) })
  }
  if (doc?.lastRun && Array.isArray(doc.lastRun.logs)) {
    if (doc.lastRun.ok !== false) doc.lastRun.logs.forEach((line, j) => take(consoleLine(str(line)), "console", j))
    return [...found.values()]
  }
  if (!Array.isArray(doc?.cells)) return []
  doc.cells.forEach((cell, i) => {
    if (str(cell?.cell_type) !== "code") return
    for (const out of cell.outputs ?? []) {
      outputText(out).split("\n").forEach((line, j) => take(line, `cell ${i + 1}`, j))
    }
  })
  return [...found.values()]
}

/**
 * A fingerprint of a notebook's outputs (with execution counts, where kept):
 * it moves when the notebook is run, not when its code is edited. Null for a
 * document without outputs.
 */
export function runKeyOf(doc) {
  if (doc?.lastRun && Array.isArray(doc.lastRun.logs)) return `l:${hash(JSON.stringify([str(doc.lastRun.at), str(doc.lastRun.input), doc.lastRun.ok !== false, doc.lastRun.logs.map(str)]))}`
  if (!Array.isArray(doc?.cells)) return null
  const cells = doc.cells.filter((c) => str(c?.cell_type) === "code").map((c) => [c.execution_count ?? null, (c.outputs ?? []).map(outputText)])
  return `r:${hash(JSON.stringify(cells))}`
}

/** A kept source's fingerprint: all its readable text, or its heads when it has none. Any change counts. */
export function sourceFingerprint(doc, heads = []) {
  const text = sourceText(doc ?? {})
  return text.trim() ? `t:${hash(text)}` : `h:${[...heads].sort().join(",")}`
}

/** Every exported name of every entry, mapped back to its id. */
export function nameIndex(entries) {
  const index = new Map()
  for (const id of Object.keys(entries ?? {})) {
    index.set(id, id)
    index.set(`${id}_min`, id)
    index.set(`${id}_max`, id)
  }
  return index
}

/** Where entries are named in one text: [{ id, line, text }], one per id per line. */
export function usesIn(text, index) {
  const found = []
  String(text ?? "").split("\n").forEach((line, i) => {
    const seen = new Set()
    for (const match of line.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
      const id = index.get(match[0])
      if (!id || seen.has(id)) continue
      seen.add(id)
      found.push({ id, line: i + 1, text: line.trim().slice(0, 240) })
    }
  })
  return found
}

/**
 * Plain `name = <number>` assignments and `"key": <number>` table entries in
 * code: each is either a register name (checked for drift) or a world fact
 * that escaped the register (a constant).
 */
export function assignmentsIn(text) {
  const found = []
  String(text ?? "").split("\n").forEach((line, i) => {
    const match = line.match(/^\s*(?:let\s+|const\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*;?\s*(?:(?:#|\/\/)(.*))?$/i)
    if (match) return void found.push({ name: match[1], value: Number(match[2]), comment: (match[3] ?? "").trim(), line: i + 1, text: line.trim().slice(0, 160) })
    const comment = line.match(/(?:#|\/\/)(.*)$/)?.[1]
    for (const pair of line.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(?=[,}\s]|$)/gi)) {
      found.push({ name: pair[1], value: Number(pair[2]), comment: (comment ?? "").trim(), line: i + 1, text: line.trim().slice(0, 160) })
    }
  })
  return found
}

const IGNORE = /^(i|j|k|n|_|dt|t|x|y|z)$/

/** Constants in model code that the register doesn't hold. */
export function constantsIn(scan, entries) {
  const index = nameIndex(entries)
  const out = []
  for (const [url, doc] of Object.entries(scan?.docs ?? {})) {
    for (const a of doc.assigns ?? []) {
      if (index.has(a.name) || IGNORE.test(a.name) || a.value === 0 || a.value === 1) continue
      out.push({ doc: doc.path, url, ...a })
    }
  }
  return out
}

/** Register names assigned a number that disagrees with the register: a pasted copy that has drifted. */
export function driftIn(scan, entries) {
  const current = new Map()
  for (const [id, entry] of Object.entries(entries ?? {})) {
    if (!isNumeric(entry.value)) continue
    for (const [name, value] of exportedNames(id, entry.value)) current.set(name, { id, value })
  }
  const out = []
  for (const [url, doc] of Object.entries(scan?.docs ?? {})) {
    for (const a of doc.assigns ?? []) {
      const known = current.get(a.name)
      if (known && typeof known.value === "number" && a.value !== known.value) out.push({ doc: doc.path, url, ...a, id: known.id, register: known.value })
    }
  }
  return out
}

const idsKeyOf = (entries) => Object.keys(entries ?? {}).sort().join(" ")
const strip = (url) => String(url).split("#")[0]

/** The error a stopped check throws. */
export const stopped = () => Object.assign(new Error("the check was stopped"), { name: "AbortError" })

/**
 * Open a document, giving up after `ms` (it is then "couldn't be opened") or
 * when `signal` stops the check.
 */
export async function openWithin(find, url, { ms = OPEN_TIMEOUT_MS, signal = null } = {}) {
  if (signal?.aborted) throw stopped()
  let timer
  let onAbort
  try {
    return await Promise.race([
      Promise.resolve().then(() => find(url)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`didn't open within ${Math.round(ms / 1000)} s`), { name: "TimeoutError" })), ms)
      }),
      new Promise((_, reject) => {
        onAbort = () => reject(stopped())
        signal?.addEventListener?.("abort", onAbort, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.("abort", onAbort)
  }
}

/** At most `limit` of the functions it is given run at once. */
export function limiter(limit) {
  let active = 0
  const waiting = []
  return async (fn) => {
    while (active >= limit) await new Promise((resolve) => waiting.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

const byOrder = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/**
 * Scan a folder, reusing what the previous scan read from documents that
 * haven't changed. Returns the new scan, to be saved as the register's `scan`:
 *
 *   at        the register's heads when it ran
 *   time      when it ran (ISO)
 *   idsKey    the register's ids it searched for
 *   docs      { [url]: { path, heads, code, runKey, outputs: [{ id, value, part, line, text }],
 *               export, hits: [{ id, use, part, line, text }],
 *               assigns: [{ name, value, comment, part, line, text }] } }
 *             a run's document that couldn't be opened: { path, missing: true }
 *   unopened  [{ url, path, why }]: folder documents that couldn't be opened
 *   read, reused, truncated
 *
 * Documents open `concurrency` at a time, each given `timeout` ms. Which
 * documents are kept under the limit doesn't depend on the order they
 * arrive in: the first MAX_DOCS in folder order. `onProgress({ phase:
 * "documents", opened, read, reused, current })` after each one; `signal`
 * stops it, throwing an AbortError.
 */
export async function scanFolder(repo, { entries, registerUrl, folderUrl, also = [], previous = null, at = [], find = (url) => repo.find(url), concurrency = CONCURRENCY, timeout = OPEN_TIMEOUT_MS, signal = null, onProgress = null }) {
  const index = nameIndex(entries)
  const ids = new Set(Object.keys(entries ?? {}))
  const idsKey = idsKeyOf(entries)
  const reusable = previous?.idsKey === idsKey ? previous.docs ?? {} : {}
  const required = new Set(also.map(strip))
  const seen = new Set(registerUrl ? [strip(registerUrl)] : [])
  const leaves = [] // { order, key, record, reused, required }
  const unopened = []
  const limit = limiter(concurrency)
  let opened = 0
  let read = 0
  let reused = 0
  let truncated = false
  const progress = (current) => onProgress?.({ phase: "documents", opened, read, reused, current })

  // A document a model run read is kept past the limit and recorded as
  // missing if it can't be opened, so the run can't pass unchecked.
  const visit = async (url, path, depth, order) => {
    const key = strip(url)
    if (seen.has(key) || depth > MAX_DEPTH) return
    seen.add(key)
    const needed = required.has(key)
    if (opened >= MAX_DOCS * 2 && !needed) return void (truncated = true)
    let handle
    let doc
    try {
      handle = await limit(() => {
        progress(path || (depth === 0 && !needed ? "the folder" : "a document"))
        return openWithin(find, url, { ms: timeout, signal })
      })
      doc = handle.doc()
      if (!doc) throw new Error("it is empty or not available")
    } catch (error) {
      if (error?.name === "AbortError") throw error
      if (needed) leaves.push({ order, key, record: { path, missing: true, heads: [], hits: [], assigns: [] }, required: true })
      else unopened.push({ url: key, path, why: error?.message ?? "it couldn't be opened" })
      return
    }
    if (needed && !path) path = doc?.title || doc?.name || ""
    if (Array.isArray(doc?.docs)) {
      await Promise.all(doc.docs.map((child, i) => (child?.url ? visit(child.url, path ? `${path}/${child.name}` : child.name, depth + 1, [...order, i]) : null)))
      return
    }
    if (doc?.["@patchwork"]?.type === "assumptions") return
    opened++
    const heads = typeof handle.heads === "function" ? [...(handle.heads() ?? [])] : []
    const before = reusable[key]
    if (before && before.code !== undefined && "runKey" in before && heads.length && JSON.stringify(before.heads) === JSON.stringify(heads)) {
      leaves.push({ order, key, record: { ...before, path }, reused: true, required: needed })
    } else {
      const parts = partsOf(doc, path)
      // A document that keeps its last run: the code that run had, from its heads then.
      let runCode
      if (Array.isArray(doc?.lastRun?.heads) && doc.lastRun.heads.length && typeof handle.view === "function") {
        try {
          const then = [...doc.lastRun.heads].map(str)
          runCode = codeOf(handle.view(then).doc(), then)
        } catch {}
      }
      const record = { path, heads, code: codeOf(doc, heads), ...(runCode ? { runCode } : {}), runKey: runKeyOf(doc), outputs: outputsOf(doc, ids), export: parts.some((p) => p.text.includes(GENERATED_MARK)), hits: [], assigns: [] }
      if (!record.export) {
        for (const { part, text, code } of parts) {
          for (const hit of usesIn(text, index)) record.hits.push({ ...hit, use: code ? "model" : "prose", part })
          if (code) for (const a of assignmentsIn(text)) record.assigns.push({ ...a, part })
        }
      }
      leaves.push({ order, key, record, reused: false, required: needed })
    }
    if (leaves.at(-1).reused) reused++
    else read++
    progress(path)
  }

  // The folder first, so a run's document in it keeps its folder path; then any run document outside it.
  if (folderUrl) await visit(folderUrl, "", 0, [0])
  await Promise.all([...required].map((url, i) => visit(url, "", 0, [1, i])))
  if (signal?.aborted) throw stopped()

  // The first MAX_DOCS in folder order, plus every document a run read.
  leaves.sort((a, b) => byOrder(a.order, b.order))
  const docs = {}
  let kept = 0
  read = 0
  reused = 0
  for (const leaf of leaves) {
    if (!leaf.required && !leaf.record.missing) {
      if (kept >= MAX_DOCS) {
        truncated = true
        continue
      }
      kept++
    }
    docs[leaf.key] = leaf.record
    if (leaf.record.missing) continue
    if (leaf.reused) reused++
    else read++
  }
  unopened.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { at: [...at], time: new Date().toISOString(), idsKey, docs, unopened, read, reused, truncated, folder: folderUrl ?? null }
}

/** Every use of one id in a scan: [{ doc, url, use, part, line, text }]. */
export function usesOf(scan, id) {
  const out = []
  for (const [url, doc] of Object.entries(scan?.docs ?? {})) {
    for (const hit of doc.hits ?? []) if (hit.id === id) out.push({ doc: doc.path, url, ...hit })
  }
  return out
}

/** Use counts per id: Map<id, { model, prose }>. */
export function useCounts(scan) {
  const out = new Map()
  for (const doc of Object.values(scan?.docs ?? {})) {
    for (const hit of doc.hits ?? []) {
      const c = out.get(hit.id) ?? { model: 0, prose: 0 }
      c[hit.use === "model" ? "model" : "prose"]++
      out.set(hit.id, c)
    }
  }
  return out
}

/** The exports of the register found in the folder. */
export function exportsIn(scan) {
  return Object.entries(scan?.docs ?? {}).filter(([, d]) => d.export).map(([url, d]) => ({ doc: d.path, url }))
}
