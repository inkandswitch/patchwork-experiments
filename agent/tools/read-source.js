/**
 * Reading what was kept.
 *
 * Every fetch keeps a document whose text is written once (see sources.js), so
 * a character offset into it names the same characters forever. That makes
 * reading on a pure function of `(text, offset, limit)` and searching a pure
 * function of `(text, find)`, and it is why these tools exist rather than
 * telling the model to page with doc_read: the 147 re-reads measured in one
 * workflow came from web-only steps whose fetch results said to page with
 * doc_read, a tool they did not have, so they fetched again. Here a model can
 * jump to a heading, search for a phrase, and see what it already holds before
 * reaching for the network.
 *
 * Which documents these may open is the repo's to decide, not theirs. In a
 * research step the repo is scoped (scope.js): it opens only the workflow's
 * ledger of kept things, at the versions recorded there, and refuses anything
 * else before asking for it. Anywhere else these read any document they are
 * given, as doc_read already can.
 */

import { interpretAsDocumentId, isValidAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from "@automerge/automerge-repo"
import { repairDocUrl } from "../doc-urls.js"
import { readable, sessionDoc, keptSources, headingAt, outline, formatOf, readOn } from "./sources.js"
import { bytes } from "./format.js"
import { imageTypeOf, imageForModel } from "../images.js"

export const READ_LIMIT = 8000
export const MAX_READ = 20000
export const MAX_MATCHES = 20
const CONTEXT = 80

/** The canonical id of anything that names a document, or null. */
function canonical(source) {
  try {
    return interpretAsDocumentId(String(source ?? "").trim())
  } catch {
    return null
  }
}

/**
 * One slice of a text: offset clamped into it, a limit of at least one
 * character and at most MAX_READ, so every read makes progress and paging
 * always ends. `next` is where to read on, or null at the end.
 */
export function slice(text, offset = 0, limit = READ_LIMIT) {
  const total = text.length
  const asked = (value, fallback) => (Number.isFinite(Number(value)) && value !== null ? Math.floor(Number(value)) : fallback)
  const start = Math.max(0, Math.min(asked(offset, 0), total))
  const size = Math.max(1, Math.min(asked(limit, READ_LIMIT), MAX_READ))
  const end = Math.min(start + size, total)
  return { start, end, total, text: text.slice(start, end), next: end < total ? end : null }
}

/**
 * Every place `find` occurs, case-insensitively, as literal text, without
 * overlaps: `{ count, matches: [{ at }] }` with at most `max` matches kept.
 * A regular expression with the `i` flag compares case without changing
 * lengths, so the offsets are offsets into the text itself.
 */
export function findAll(text, find, max = MAX_MATCHES) {
  const needle = String(find ?? "")
  if (!needle) return { count: 0, matches: [] }
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
  const matches = []
  let count = 0
  for (const match of text.matchAll(pattern)) {
    count++
    if (matches.length < max) matches.push({ at: match.index })
  }
  return { count, matches }
}

const oneLine = (text) => text.replace(/\s+/g, " ").trim()

/** The text around one match, on one line. */
function around(text, at, length) {
  const from = Math.max(0, at - CONTEXT)
  const to = Math.min(text.length, at + length + CONTEXT)
  return `${from > 0 ? "…" : ""}${oneLine(text.slice(from, to))}${to < text.length ? "…" : ""}`
}

/**
 * The handle for a whole document, however it was named, at the heads the
 * name pins if it pins any. A path in the name would open a part of the
 * document instead, which is not a source.
 */
export async function openDocument(source, repo) {
  // A run-on or quoted URL is mended (doc-urls.js); the repo mends the rest.
  const name = repairDocUrl(String(source ?? "").trim()).url
  const id = canonical(name)
  if (!id) throw new Error(`'${name}' does not name a document. Pass the automerge: URL a fetch gave you.`)
  const heads = isValidAutomergeUrl(name) ? parseAutomergeUrl(name).heads : undefined
  const handle = await repo.find(stringifyAutomergeUrl({ documentId: id, heads }))
  if (!handle.doc()) throw new Error(`${name} could not be loaded.`)
  return handle
}

const titleOf = (doc) => doc.name ?? doc.title ?? "untitled"

export const sourceRead = {
  id: "source_read",
  name: "Read a kept source",
  target: { fields: ["source"] },
  description: [
    "Read a fetched page, PDF or response that was kept as a document — every web_fetch and http_request result names one — or a finding a research step wrote. Free, instant, and the offsets never shift, so prefer it to fetching again.",
    "",
    "Page through with `offset` and `limit`: the result says which heading you are under and where to read on. Or pass `find` to search: it lists each match with its offset and the heading it is under, and then you read from one of those offsets.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["source"],
    properties: {
      source: { type: "string", description: "The automerge: URL of the kept source, as a fetch result gave it." },
      offset: { type: "number", description: "Character to start at. Default 0. Use an offset from an earlier read, a match, or the outline." },
      limit: { type: "number", description: `How many characters. Default ${READ_LIMIT}, at most ${MAX_READ}.` },
      find: {
        type: "string",
        description: `Text to search for instead of reading: case-insensitive and literal. Lists up to ${MAX_MATCHES} matches with their offsets.`,
      },
    },
  },

  async execute(input, ctx) {
    const handle = await openDocument(input.source, ctx.repo)
    const doc = handle.doc()
    const url = handle.url
    const name = titleOf(doc)
    const text = readable(doc)
    if (text == null) {
      const imageType = imageTypeOf(doc)
      if (imageType) {
        const shown = await imageForModel(doc.content, imageType)
        if (shown) return { text: `'${name}' (${url}) — an image (${imageType}, ${bytes(doc.content.byteLength)}), attached to this result.`, image: shown.url }
      }
      const content = doc.content
      const kind = (content && formatOf(content)) ?? doc.mimeType ?? "binary"
      const size = content?.byteLength != null ? `, ${bytes(content.byteLength)}` : ""
      return `This is binary (${kind}${size}) with no text kept; open it in Patchwork.`
    }
    const marks = Array.isArray(doc.marks) ? doc.marks : []

    const find = String(input.find ?? "")
    if (find.trim()) {
      const { count, matches } = findAll(text, find)
      if (!count) {
        return `'${name}' (${url}) — no match for "${find}" in ${text.length} characters.${outline(marks) ? `\n${outline(marks)}` : ""}`
      }
      const lines = [
        `'${name}' (${url}) — ${count} match${count === 1 ? "" : "es"} for "${find}"${count > matches.length ? `, first ${matches.length} shown` : ""}. Read around one with ${readOn(url, matches[0].at)}.`,
        ...matches.map(({ at }) => `${at} · ${headingAt(marks, at)?.label ?? "(top)"} · ${around(text, at, find.length)}`),
      ]
      return lines.join("\n")
    }

    const part = slice(text, input.offset ?? 0, input.limit ?? READ_LIMIT)
    const under = headingAt(marks, part.start)
    const header = `'${name}' (${url}) — characters ${part.start}–${part.end} of ${part.total}${under ? ` · under "${under.label}"` : ""}`
    const after = part.next == null ? "That is the end." : `${part.total - part.end} remaining; next: offset ${part.next}.`
    return `${header}\n${after}\n\n${part.text}`
  },

  summarize(input, output) {
    const text = String(output ?? "")
    const range = text.match(/characters (\d+)–(\d+) of (\d+)/)
    if (range) return `read ${range[1]}–${range[2]} of ${range[3]}`
    const found = text.match(/— (\d+) match/)
    if (found) return `found "${input?.find}" · ${found[1]}`
    if (/no match for/.test(text)) return `found "${input?.find}" · 0`
    return text.startsWith("This is binary") ? "binary, no text" : "read source"
  },
}

export const sourceList = {
  id: "source_list",
  name: "List kept sources",
  target: "none",
  description: [
    "List the sources kept so far — every page, PDF and response fetched, and in a research step every finding written — newest first, with each one's size and URL. Check it before fetching: what is here is free to read with source_read.",
    "",
    "Pass `find` to search all of them at once: it says how many times each one mentions it and where the first mention is.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      find: { type: "string", description: "Text to search every kept source for: case-insensitive and literal." },
    },
  },

  async execute(input, ctx) {
    if (!ctx.scope && !sessionDoc(ctx)) throw new Error("This runner cannot reach the conversation, so it cannot tell what was kept.")
    // A research step lists the workflow's ledger, findings included: they are
    // what it and its sibling steps have learned, and as readable as a page.
    const kept = ctx.scope ? ctx.repo.sources() : keptSources(ctx)
    if (!kept.length) return "Nothing has been kept yet. Every web_fetch and http_request keeps what it fetched."

    const find = String(input.find ?? "")
    const lines = []
    let hits = 0
    for (const entry of kept) {
      let doc = null
      try {
        doc = (await ctx.repo.find(entry.url)).doc()
      } catch {
        /* listed below as unreadable */
      }
      const text = readable(doc)
      const what = entry.what ?? (doc?.role === "extract" ? "extract" : doc?.mimeType === "application/pdf" ? "pdf" : "file")
      const size = text != null ? `${text.length} chars` : doc ? "binary" : "not loaded"
      if (find.trim()) {
        if (text == null) continue
        const { count, matches } = findAll(text, find, 1)
        if (!count) continue
        hits++
        lines.push(`${entry.name} · ${count} match${count === 1 ? "" : "es"}, first at ${matches[0].at} · ${entry.url}`)
      } else {
        lines.push([entry.name, what, size, entry.url, entry.source, entry.by ? `by ${entry.by}` : null].filter(Boolean).join(" · "))
      }
    }
    if (find.trim()) {
      return hits
        ? `"${find}" appears in ${hits} of ${kept.length} kept sources:\n${lines.join("\n")}`
        : `"${find}" appears in none of the ${kept.length} kept sources.`
    }
    return `${kept.length} kept source${kept.length === 1 ? "" : "s"}, newest first:\n${lines.join("\n")}`
  },

  summarize(input, output) {
    const text = String(output ?? "")
    const listed = text.match(/^(\d+) kept source/)
    if (listed) return `${listed[1]} sources`
    const found = text.match(/appears in (\d+) of (\d+)/)
    if (found) return `"${input?.find}" in ${found[1]} of ${found[2]}`
    if (/appears in none/.test(text)) return `"${input?.find}" in none`
    return "no sources yet"
  },
}

export default [sourceRead, sourceList]
