/**
 * Keeping what a capture fetched, as documents the agent can read back.
 *
 * Copied from the agent's tools/sources.js and tools/web.js, and trimmed to
 * what web_capture needs: it is copied rather than imported because this
 * package must work when its folder is copied out alone. What it writes is the
 * agent's "source contract", so a snapshot, a kept PDF or a reader's extract
 * made here reads with the agent's source_read exactly as one made there:
 *
 *   source       the URL as requested
 *   capture      { at, finalUrl, via: "direct"|"reader",
 *                  engine: "raw"|"reader-markdown"|"reader-dom",
 *                  status, contentType, sha256, bytes, readerCache }
 *   content      the primary: Uint8Array for bytes, ImmutableString for text
 *                (a web snapshot holds `html` instead: its frozen page)
 *   role         "primary" (the response itself) | "extract" (the reader's text)
 *   text         ImmutableString | null — readable text beside the primary
 *   textVia      "reader" | "html-to-text" | null
 *   marks        [{ at, label }] — headings, as offsets into readable(doc)
 *   pages        null until page offsets exist
 *   missing      null | { what: "pdf" | "primary", outcome, detail } — what could not be kept
 *
 * Keeping is not best-effort: a capture whose result could not be kept fails,
 * because "kept at automerge:…" must always be true.
 */

import { ImmutableString, isImmutableString } from "@automerge/automerge"
import { sha256Hex } from "./capture/bytes.js"
import { MAX_MARKS, fewest } from "./capture/text.js"

/** The reader that renders a page, and reads one as markdown. */
export const DEFAULT_READER = "https://r.jina.ai/"

/** The largest PDF kept as bytes. Past this the reader's text is kept instead, and says why. */
export const MAX_PDF_BYTES = 30 * 1024 * 1024

const MIME_EXTENSIONS = {
  "text/markdown": "md",
  "text/html": "html",
  "text/plain": "txt",
  "application/json": "json",
  "text/csv": "csv",
  "application/wasm": "wasm",
  "application/octet-stream": "bin",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "font/woff2": "woff2",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
}

/**
 * Media types that are text however they are spelled. Everything else is
 * kept as bytes: decoding bytes as UTF-8 silently replaces every invalid
 * sequence, which destroys the data and still looks like a success.
 */
const TEXT_TYPES = /^text\/|^application\/(json|xml|javascript|ecmascript|x-ndjson|graphql)|\+json$|\+xml$/i

/** A size a person reads: bytes, kB or MB. */
export function size(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The media type alone, lowercased, without parameters. */
export function mediaType(contentType) {
  return String(contentType ?? "").split(";")[0].trim().toLowerCase()
}

/** Does this response carry text, or bytes? With no type, a NUL in the first kilobyte means bytes. */
export function isTextResponse(contentType, bytes) {
  const type = mediaType(contentType)
  if (type) return TEXT_TYPES.test(type)
  if (!bytes) return true
  return !bytes.subarray(0, 1024).includes(0)
}

/**
 * Text out of bytes, by the label the bytes say they are in: a byte-order mark
 * first, then the header's charset, then UTF-8. A label TextDecoder does not
 * know falls back to UTF-8 rather than failing a fetch that worked.
 */
export function decodeText(bytes, contentType) {
  let label = "utf-8"
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = "utf-8"
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le"
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be"
  else {
    const match = String(contentType ?? "").match(/;\s*charset\s*=\s*"?([^";\s]+)/i)
    if (match) label = match[1]
  }
  let decoder
  try {
    decoder = new TextDecoder(label)
  } catch {
    decoder = new TextDecoder("utf-8")
  }
  return decoder.decode(bytes)
}

/** A readable file name for fetched content, from its title or its URL. */
export function sourceName(url, title, extension = "md") {
  const fallback = () => {
    try {
      const parsed = new URL(url)
      const last = parsed.pathname.split("/").filter(Boolean).pop()
      return last ? `${parsed.host} ${last}` : parsed.host
    } catch {
      return "fetched"
    }
  }
  const base = (title ?? "").trim() || fallback()
  const safe = base
    .replace(/[\/\\:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  const stem = safe || "fetched"
  return stem.endsWith(`.${extension}`) ? stem : `${stem}.${extension}`
}

/** The reader puts `Title: …` on the first line of its markdown; use it if it is there. */
export function titleFrom(markdown) {
  const match = String(markdown ?? "").match(/^Title:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

/** A text value, written once (ImmutableString) or as a plain string; null for anything else. */
function asText(value) {
  if (typeof value === "string") return value
  if (isImmutableString(value)) return String(value)
  return null
}

/** The text a kept source reads as: `text` when there is one, else the content when it is text. */
export function readable(doc) {
  if (!doc) return null
  const text = asText(doc.text)
  if (text != null) return text
  return asText(doc.content)
}

/**
 * Headings as marks: where each one starts, as a character offset, and the
 * heading as a markdown line. ATX (`## Title`) and setext (`Title` over `===`
 * or `---`) both count; anything inside a fenced code block does not.
 */
export function marksFromMarkdown(text) {
  const lines = String(text ?? "").split("\n")
  const marks = []
  let at = 0
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "")
    const start = at
    at += lines[i].length + 1

    const opener = line.match(/^\s{0,3}(```|~~~)/)
    if (opener) {
      if (!fence) fence = opener[1]
      else if (opener[1] === fence) fence = null
      continue
    }
    if (fence) continue

    const atx = line.match(/^\s{0,3}(#{1,6})[ \t]+(.*)$/)
    if (atx) {
      // A closing run of #s counts only with a space before it, as in
      // CommonMark: `## Learn C#` keeps its #, `## Title ##` drops the run.
      const heading = atx[2].replace(/(^|[ \t])#+[ \t]*$/, "").trim()
      if (heading) marks.push({ at: start, label: `${atx[1]} ${heading}`.slice(0, 120) })
      continue
    }
    // Setext: a line of text underlined. A list item or a quote above a rule
    // is not a heading, so they are left out.
    const next = (lines[i + 1] ?? "").replace(/\r$/, "")
    if (!line.trim() || /^\s{0,3}([-*+>]|\d+[.)])(\s|$)/.test(line)) continue
    if (/^\s{0,3}=+\s*$/.test(next)) marks.push({ at: start, label: `# ${line.trim()}`.slice(0, 120) })
    else if (/^\s{0,3}-{2,}\s*$/.test(next)) marks.push({ at: start, label: `## ${line.trim()}`.slice(0, 120) })
  }
  return fewest(marks, MAX_MARKS)
}

/** A one-line outline, `offset label · offset label`, of at most `max` marks. */
export function outline(marks, max = 20) {
  if (!marks?.length) return null
  const shown = fewest(marks, max)
  const more = shown.length < marks.length ? " · …" : ""
  return `Outline: ${shown.map((m) => `${m.at} ${m.label}`).join(" · ")}${more}`
}

/** How a result refers to a kept source, so the agent can come back to it with its source_read. */
export const readOn = (url, offset) => `source_read {source:"${url}", offset:${offset}}`

/**
 * What has been kept before, newest first, by whoever handed this the
 * context. In a research step `ctx.repo` is the step's scoped repo, and its
 * `sources()` is the workflow's ledger: every step's kept sources. Elsewhere
 * the agent records each document a tool returns in its session's `made`,
 * with `source` and `what`, and hands a plugin that session to read. Without
 * either there is nothing kept to find.
 */
export function keptSources(ctx) {
  try {
    if (typeof ctx?.repo?.sources === "function") return ctx.repo.sources().filter((entry) => entry?.kind === "source" && entry?.source)
    return (ctx?.session?.doc?.()?.made ?? []).filter((entry) => entry?.source)
  } catch {
    return []
  }
}

/** A plain Uint8Array over the same bytes, whatever view arrived. */
function toBytes(view) {
  if (view instanceof Uint8Array) return view
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * Keep one fetched thing as a `file` document, under the source contract.
 *
 *   source     the URL as requested
 *   role       "primary" | "extract"
 *   content    Uint8Array (kept byte for byte) or a string (kept as an ImmutableString)
 *   mimeType   decides the extension, so the File tool shows it right
 *   capture    { finalUrl, via, engine, status, contentType, readerCache } — `at`,
 *              `sha256` and `bytes` are filled in here, from the content
 *   text       readable text beside the primary, and `textVia` saying where it came from
 *   missing    what could not be kept, and why
 *
 * Returns `{ ref, marks, capture }`: the reference a tool result carries, the
 * marks for the result's outline, and the capture as written.
 */
export async function keepSource(ctx, opts) {
  if (!ctx?.repo?.create2) throw new Error("There is no repo here, so nothing fetched can be kept.")
  const { source, role = "primary", content, mimeType = "text/markdown", title = null } = opts
  const binary = content instanceof Uint8Array || ArrayBuffer.isView(content)
  const body = binary ? toBytes(content) : String(content ?? "")
  const primaryBytes = binary ? body : new TextEncoder().encode(body)
  const text = opts.text == null ? null : String(opts.text)
  const textVia = text == null ? null : opts.textVia ?? "reader"

  const type = mediaType(mimeType)
  const extension = MIME_EXTENSIONS[type] ?? (binary ? "bin" : "txt")
  const fileName = sourceName(source, title ?? (binary ? null : titleFrom(body)), extension)
  const readableText = text ?? (binary ? null : body)
  const markdownish = textVia === "reader" || (text == null && type === "text/markdown")
  const marks = markdownish && readableText ? marksFromMarkdown(readableText) : []

  const given = opts.capture ?? {}
  const capture = {
    at: given.at ?? Date.now(),
    finalUrl: given.finalUrl ?? null,
    via: given.via ?? "direct",
    engine: given.engine ?? "raw",
    status: given.status ?? null,
    contentType: given.contentType ?? null,
    sha256: await sha256Hex(primaryBytes),
    bytes: primaryBytes.byteLength,
    readerCache: given.readerCache ?? null,
  }

  const handle = await ctx.repo.create2()
  handle.change((doc) => {
    doc["@patchwork"] = { type: "file" }
    doc.name = fileName
    doc.extension = extension
    doc.mimeType = mimeType
    doc.content = binary ? body : new ImmutableString(body)
    doc.role = role
    doc.source = source
    doc.capture = capture
    doc.text = text == null ? null : new ImmutableString(text)
    doc.textVia = textVia
    doc.marks = marks
    doc.pages = null
    doc.missing = opts.missing ?? null
  })

  const ref = {
    url: handle.url,
    name: fileName,
    kind: "source",
    bytes: capture.bytes,
    chars: readableText == null ? null : readableText.length,
    mimeType,
    binary,
    role,
    source,
    engine: capture.engine,
    at: capture.at,
  }
  return { ref, marks, capture }
}

/**
 * Keep a response that is not a page exactly as it came: text decoded by its
 * own charset, bytes as bytes. Only web_capture calls this, and only for a
 * body capture/sniff.js says is not HTML, so unlike the agent's copy it has no
 * branch for an HTML page's text.
 */
export async function keepResponse(ctx, { source, response, body, at }) {
  const contentType = response.headers?.get?.("content-type") ?? null
  const textual = isTextResponse(contentType, body)
  const type = mediaType(contentType) || (textual ? "text/plain" : "application/octet-stream")
  const capture = { at, finalUrl: response.url || null, via: "direct", engine: "raw", status: response.status ?? null, contentType }
  return keepSource(ctx, { source, content: textual ? decodeText(body, contentType) : body, mimeType: type, capture })
}

/** Does the URL's path say PDF? */
export function pdfByPath(url) {
  try {
    return /\.pdf$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** The reader's URL for a target. */
export function readerUrl(target, reader = DEFAULT_READER) {
  return reader + target
}

/**
 * Headers that tell the reader what to send back. `x-no-cache` opts out of
 * its cache, which matters when the question is what a page says now.
 */
export function readerHeaders(format = "markdown", fresh = false) {
  const headers = { accept: "text/plain", "X-Return-Format": format }
  if (fresh) headers["x-no-cache"] = "true"
  return headers
}

const n = (value) => Number(value ?? 0).toLocaleString("en-US")

/** Keep the PDF's bytes with the reader's text, or the reader's text with the reason the PDF is missing. */
export async function keepPdf(target, { pdf, markdown, readerStatus, readerCache, at }, ctx) {
  if (pdf.ok) {
    const { ref, marks, capture } = await keepSource(ctx, {
      source: target,
      content: pdf.body,
      mimeType: "application/pdf",
      title: titleFrom(markdown),
      text: markdown,
      textVia: "reader",
      capture: {
        at,
        finalUrl: pdf.response.url || null,
        via: "direct",
        engine: "raw",
        status: pdf.response.status ?? null,
        contentType: pdf.response.headers?.get?.("content-type") ?? null,
      },
    })
    const what =
      markdown != null
        ? `Kept the PDF itself (${n(ref.bytes)} bytes, sha256 ${capture.sha256.slice(0, 8)}…) and its text (${n(ref.chars)} chars, via reader) at ${ref.url}`
        : `Kept the PDF itself (${n(ref.bytes)} bytes, sha256 ${capture.sha256.slice(0, 8)}…) at ${ref.url}. It has no text: the reader was unavailable (${readerStatus}), so open it in Patchwork to read it.`
    return { ref, marks, text: markdown, lead: what }
  }
  if (markdown == null) {
    throw new Error(
      `Could not keep ${target}: the PDF could not be fetched from here (${pdf.outcome}: ${pdf.detail}) and the reader was unavailable (${readerStatus}).`
    )
  }
  const { ref, marks } = await keepSource(ctx, {
    source: target,
    role: "extract",
    content: markdown,
    mimeType: "text/markdown",
    capture: { at, via: "reader", engine: "reader-markdown", readerCache },
    missing: { what: "pdf", outcome: pdf.outcome, detail: pdf.detail },
  })
  const lead = `Kept the reader's text (${n(ref.chars)} chars) at ${ref.url}; the PDF itself could not be fetched from here (${pdf.outcome}: ${pdf.detail}).`
  return { ref, marks, text: markdown, lead }
}
