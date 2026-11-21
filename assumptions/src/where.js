/**
 * Where a register's entries are used: walk the folder it serves, read each
 * document's text, and find every entry id in it — plus the constants model
 * code writes down itself instead of reading from the register.
 *
 * What counts as text, by datatype:
 *
 *   jupyter-notebook   each cell's source ("cell 3"); code cells are code
 *   openscad           `source`, code
 *   file / markdown    `content`; code when the extension is a code one
 *   datagrid           its cells, as one line per row
 *
 * Left out: the register itself, kept sources (web snapshots and captured
 * files: a datasheet does not "use" an id), and exports of this register,
 * which are listed separately — each one names every entry by construction.
 */

import { GENERATED_MARK, driftIn, nameIndex, unboundIn, usesIn } from "./model.js"

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

function isFolder(doc) {
  return Array.isArray(doc?.docs)
}

/**
 * Walk a folder and report, for a register doc:
 *
 *   uses      Map<id, [{ doc, url, part, line, text }]>
 *   unused    ids nothing in the folder names
 *   unbound   [{ doc, url, part, line, name, value, comment }] — literals in code
 *   drift     [{ doc, url, part, line, name, id, written, register }]
 *   exports   [{ doc, url }] — files generated from this register
 *   scanned   how many documents were read; `truncated` if the walk stopped early
 */
export async function whereUsed(repo, { register, registerUrl, folderUrl, variant = null, find = (url) => repo.find(url) }) {
  const index = nameIndex(register)
  const uses = new Map()
  const unbound = []
  const drift = []
  const exports = []
  const seen = new Set(registerUrl ? [strip(registerUrl)] : [])
  let scanned = 0
  let truncated = false

  const visit = async (url, path, depth) => {
    const key = strip(url)
    if (seen.has(key) || depth > MAX_DEPTH) return
    seen.add(key)
    if (scanned >= MAX_DOCS) return void (truncated = true)
    let doc
    try {
      doc = (await find(url)).doc()
    } catch {
      return
    }
    if (isFolder(doc)) {
      for (const entry of doc.docs) if (entry?.url) await visit(entry.url, path ? `${path}/${entry.name}` : entry.name, depth + 1)
      return
    }
    if (doc?.["@patchwork"]?.type === "assumptions") return
    scanned++
    const parts = partsOf(doc, path)
    if (parts.some((p) => p.text.includes(GENERATED_MARK))) return void exports.push({ doc: path, url })
    for (const { part, text, code } of parts) {
      for (const [id, places] of usesIn(text, index)) {
        const list = uses.get(id) ?? []
        for (const place of places) list.push({ doc: path, url, part, ...place })
        uses.set(id, list)
      }
      if (code) {
        for (const hit of unboundIn(text, index)) unbound.push({ doc: path, url, part, ...hit })
        for (const hit of driftIn(text, register, variant)) drift.push({ doc: path, url, part, ...hit })
      }
    }
  }

  if (folderUrl) await visit(folderUrl, "", 0)
  const ids = Object.keys(register?.entries ?? {})
  return { uses, unused: ids.filter((id) => !uses.has(id)).sort(), unbound, drift, exports, scanned, truncated }
}

/** A document url without its heads, for "have I seen this". */
function strip(url) {
  return String(url).split("#")[0]
}

/** The report as text, for the agent. */
export function describeUses(report, { id = null } = {}) {
  const place = (u) => `${u.doc || "(doc)"}${u.part ? ` ${u.part}` : ""}:${u.line}`
  const lines = []
  const ids = id ? [id] : [...report.uses.keys()].sort()
  for (const each of ids) {
    const list = report.uses.get(each) ?? []
    lines.push(`${each} — ${list.length ? `${list.length} use${list.length === 1 ? "" : "s"}` : "not used"}`)
    for (const u of list.slice(0, id ? 50 : 6)) lines.push(`  ${place(u)}  ${u.text}`)
    if (list.length > (id ? 50 : 6)) lines.push(`  …and ${list.length - (id ? 50 : 6)} more`)
  }
  if (!id) {
    if (report.unused.length) lines.push("", `Not used anywhere in the folder: ${report.unused.join(", ")}`)
    if (report.unbound.length) {
      lines.push("", `Constants written into model code, not read from the register (${report.unbound.length}). Each is a number the register should hold:`)
      for (const u of report.unbound.slice(0, 40)) lines.push(`  ${place(u)}  ${u.name} = ${u.value}${u.comment ? `  # ${u.comment}` : ""}`)
      if (report.unbound.length > 40) lines.push(`  …and ${report.unbound.length - 40} more`)
    }
    if (report.drift.length) {
      lines.push("", "Register names assigned a different number than the register holds:")
      for (const d of report.drift) lines.push(`  ${place(d)}  ${d.name} = ${d.written}, register says ${d.register}`)
    }
    if (report.exports.length) lines.push("", `Exports of this register: ${report.exports.map((e) => `${e.doc} (${e.url})`).join(", ")}`)
  }
  lines.push("", `${report.scanned} documents read${report.truncated ? " (stopped early: too many documents)" : ""}.`)
  return lines.join("\n")
}
