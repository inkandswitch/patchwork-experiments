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
 */

import { GENERATED_MARK, exportedNames } from "./export.js"
import { isNumeric } from "./values.js"

const CODE_EXTENSIONS = new Set(["py", "scad", "js", "mjs", "ts", "jl", "m", "r"])
const MAX_DOCS = 400
const MAX_DEPTH = 8

function textOf(content) {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return new TextDecoder("utf-8", { fatal: false }).decode(content)
  const text = String(content)
  return text === "[object Object]" ? "" : text
}

function cellSource(cell) {
  return Array.isArray(cell?.source) ? cell.source.join("") : textOf(cell?.source)
}

/** The readable parts of one document: [{ part, text, code }]. Empty for what is not read. */
export function partsOf(doc, name = "") {
  if (!doc || typeof doc !== "object") return []
  const type = doc["@patchwork"]?.type
  if (type === "web-snapshot" || doc.capture != null) return []
  if (Array.isArray(doc.cells)) {
    return doc.cells.map((cell, i) => ({ part: `cell ${i + 1}`, text: cellSource(cell), code: cell?.cell_type === "code" }))
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

/** Everything readable in a kept source: the parts any model reads, plus a capture's extracted text. */
export function sourceText(doc) {
  const parts = partsOf({ ...doc, capture: null }).map((p) => p.text)
  for (const key of ["text", "content", "markdown"]) if (typeof doc?.[key] === "string" && !parts.includes(doc[key])) parts.push(doc[key])
  return parts.join("\n")
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

/**
 * Scan a folder, reusing what the previous scan read from documents that
 * haven't changed. Returns the new scan, to be saved as the register's `scan`:
 *
 *   at        the register's heads when it ran
 *   time      when it ran (ISO)
 *   idsKey    the register's ids it searched for
 *   docs      { [url]: { path, heads, export, hits: [{ id, use, part, line, text }],
 *               assigns: [{ name, value, comment, part, line, text }] } }
 *   read, reused, truncated
 */
export async function scanFolder(repo, { entries, registerUrl, folderUrl, previous = null, at = [], find = (url) => repo.find(url) }) {
  const index = nameIndex(entries)
  const idsKey = idsKeyOf(entries)
  const reusable = previous?.idsKey === idsKey ? previous.docs ?? {} : {}
  const docs = {}
  const seen = new Set(registerUrl ? [strip(registerUrl)] : [])
  let read = 0
  let reused = 0
  let count = 0
  let truncated = false

  const visit = async (url, path, depth) => {
    const key = strip(url)
    if (seen.has(key) || depth > MAX_DEPTH) return
    seen.add(key)
    if (count >= MAX_DOCS) return void (truncated = true)
    let handle
    let doc
    try {
      handle = await find(url)
      doc = handle.doc()
    } catch {
      return
    }
    if (Array.isArray(doc?.docs)) {
      for (const child of doc.docs) if (child?.url) await visit(child.url, path ? `${path}/${child.name}` : child.name, depth + 1)
      return
    }
    if (doc?.["@patchwork"]?.type === "assumptions") return
    count++
    const heads = typeof handle.heads === "function" ? [...(handle.heads() ?? [])] : []
    const before = reusable[key]
    if (before && heads.length && JSON.stringify(before.heads) === JSON.stringify(heads)) {
      docs[key] = { ...before, path }
      reused++
      return
    }
    read++
    const parts = partsOf(doc, path)
    const record = { path, heads, export: parts.some((p) => p.text.includes(GENERATED_MARK)), hits: [], assigns: [] }
    if (!record.export) {
      for (const { part, text, code } of parts) {
        for (const hit of usesIn(text, index)) record.hits.push({ ...hit, use: code ? "model" : "prose", part })
        if (code) for (const a of assignmentsIn(text)) record.assigns.push({ ...a, part })
      }
    }
    docs[key] = record
  }

  if (folderUrl) await visit(folderUrl, "", 0)
  return { at: [...at], time: new Date().toISOString(), idsKey, docs, read, reused, truncated, folder: folderUrl ?? null }
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
