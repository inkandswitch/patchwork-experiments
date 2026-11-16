/**
 * Everything fetched is kept, as a document, and read from there.
 *
 * A fetched page used to exist only as text inside a tool result: it cost
 * context on every later turn, a person could not open it, nothing could link
 * to it, and a PDF arrived as somebody else's markdown of it. Now every
 * successful fetch leaves exactly one new document, and nothing ever overwrites
 * one:
 *
 *   - the response itself when we have it — a PDF's bytes, a JSON body, an
 *     image — as an ordinary `file` document the File tool can show;
 *   - otherwise the reader's extract, labelled `role: "extract"` so nobody
 *     mistakes it for the page.
 *
 * Readable text sits beside the bytes as an ImmutableString written once, so
 * `(document, offset)` names the same characters forever and `source_read` can
 * page through and search it without the offsets ever going stale. Every
 * pointer a result gives the model — the footer here, the stand-in for a
 * shortened result, the skill text — names `source_read`.
 *
 * Keeping is not best-effort. A fetch whose result could not be kept is
 * reported as a failure, because "kept at automerge:…" must always be true.
 *
 * The document shape (the "source contract"):
 *
 *   source       the URL as requested
 *   capture      { at, finalUrl, via: "direct"|"reader",
 *                  engine: "raw"|"reader-markdown"|"reader-text",
 *                  status, contentType, sha256, bytes, readerCache }
 *   content      the primary: Uint8Array for bytes, ImmutableString for text
 *   role         "primary" (the response itself) | "extract" (the reader's text)
 *   text         ImmutableString | null — readable text beside the primary
 *   textVia      "reader" | "html-to-text" | null
 *   marks        [{ at, label }] — headings, as offsets into readable(doc)
 *   pages        null until page offsets exist
 *   missing      null | { what: "pdf", outcome, detail } — what we could not keep
 */

import { ImmutableString, isImmutableString } from "@automerge/automerge"

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

/** The largest PDF kept as bytes. Past this the reader's text is kept instead, and says why. */
export const MAX_PDF_BYTES = 30 * 1024 * 1024

/**
 * Media types that are text however they are spelled.
 *
 * Everything else is treated as bytes. That is the safe way round: decoding
 * bytes as UTF-8 silently replaces every invalid sequence with U+FFFD, which
 * destroys the data and leaves something that still looks like a successful
 * result. Encoding text as bytes loses nothing.
 */
const TEXT_TYPES = /^text\/|^application\/(json|xml|javascript|ecmascript|x-ndjson|graphql)|\+json$|\+xml$/i

/** The media type alone, lowercased, without parameters. */
export function mediaType(contentType) {
  return String(contentType ?? "").split(";")[0].trim().toLowerCase()
}

/** Does this response carry text, or bytes? */
export function isTextResponse(contentType, bytes) {
  const type = mediaType(contentType)
  if (type && TEXT_TYPES.test(type)) return true
  if (type) return false

  // No content-type at all: sniff. A NUL byte in the first kilobyte has meant
  // "binary" since diff(1), and it is still the cheapest reliable signal.
  if (!bytes) return true
  const head = bytes.subarray(0, 1024)
  return !head.includes(0)
}

/**
 * The first few bytes, as hex, with the format named when we recognise it.
 *
 * A model that asked for a wasm module needs some way to tell that it got one.
 * The magic number is the answer a person would look at, so it is the answer to
 * give: `00 61 73 6d` is `\0asm` and nothing else is.
 */
export const MAGIC = [
  [[0x00, 0x61, 0x73, 0x6d], "WebAssembly module"],
  [[0x1f, 0x8b], "gzip"],
  [[0x50, 0x4b, 0x03, 0x04], "zip"],
  [[0x25, 0x50, 0x44, 0x46], "PDF"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x47, 0x49, 0x46, 0x38], "GIF"],
]

/** The format's name, from its magic number, or null. */
export function formatOf(bytes) {
  const head = [...(bytes?.subarray?.(0, 8) ?? [])]
  return MAGIC.find(([magic]) => magic.every((byte, i) => head[i] === byte))?.[1] ?? null
}

export function describeBytes(bytes) {
  const hex = [...bytes.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join(" ")
  const known = formatOf(bytes)
  return known ? `${hex} — ${known}` : hex
}

/** Does this start the way every PDF starts? */
export function isPdf(bytes) {
  return formatOf(bytes) === "PDF"
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

/**
 * The text every reader of a kept source reads: `text` when there is one,
 * else the content when the content is text, else null (bytes and nothing
 * readable beside them).
 */
export function readable(doc) {
  if (!doc) return null
  const text = asText(doc.text)
  if (text != null) return text
  return asText(doc.content)
}

/** Hex SHA-256 of some bytes, for telling one kept response from another. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export const MAX_MARKS = 200

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

const level = (mark) => mark.label.match(/^#*/)[0].length || 1

/**
 * At most `max` marks, keeping the outline's top: every heading down to the
 * deepest level that still fits, in document order. When even the top level
 * does not fit, its first `max`.
 */
export function fewest(marks, max) {
  if (marks.length <= max) return marks
  for (let depth = 5; depth >= 1; depth--) {
    const kept = marks.filter((m) => level(m) <= depth)
    if (kept.length <= max) return kept
  }
  return marks.filter((m) => level(m) === 1).slice(0, max)
}

/** The heading a character offset sits under: the last mark at or before it. */
export function headingAt(marks, offset) {
  let found = null
  for (const mark of marks ?? []) {
    if (mark.at <= offset) found = mark
    else break
  }
  return found
}

/** A one-line outline, `offset label · offset label`, of at most `max` marks. */
export function outline(marks, max = 20) {
  if (!marks?.length) return null
  const shown = fewest(marks, max)
  const more = shown.length < marks.length ? " · …" : ""
  return `Outline: ${shown.map((m) => `${m.at} ${m.label}`).join(" · ")}${more}`
}

/** The session document, when this runner can reach it. */
export async function sessionDoc(ctx) {
  if (!ctx?.sessionUrl || !ctx?.repo?.find) return null
  try {
    return (await ctx.repo.find(ctx.sessionUrl)).doc() ?? null
  } catch {
    return null
  }
}

/**
 * The newest source this session has kept from `source` by one of `engines`
 * that has text to read, or null. What a session has kept is what it recorded
 * in `made`, which is why recordArtifact keeps `source`, `engine` and `chars`.
 * A copy with no text (a PDF's bytes kept without the reader's text) cannot
 * answer a request to read the page, so it never does.
 */
export async function findKept(ctx, { source, engines }) {
  const made = (await sessionDoc(ctx))?.made ?? []
  return made.find((entry) => entry.source === source && engines.includes(entry.engine) && entry.chars != null) ?? null
}

/** A plain Uint8Array over the same bytes, whatever view arrived. */
function toBytes(view) {
  if (view instanceof Uint8Array) return view
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * Keep one fetched thing as a document, under the source contract above.
 *
 *   source     the URL as requested
 *   role       "primary" | "extract"
 *   content    Uint8Array (kept byte for byte) or a string (kept as an ImmutableString)
 *   mimeType   decides the extension, so the File tool shows it right
 *   capture    { finalUrl, via, engine, status, contentType, readerCache } — `at`,
 *              `sha256` and `bytes` are filled in here, from the content
 *   text       readable text beside the primary, and `textVia` saying where it came from
 *   marks      headings; derived from the readable text when that is markdown
 *   missing    what could not be kept, and why
 *
 * Returns `{ ref, marks }`: the reference a result block carries (small, since
 * it is stored on the result), and the marks for the result's outline.
 * Errors propagate.
 */
export async function keepSource(ctx, opts) {
  if (!ctx?.repo?.create2) throw new Error("This runner has no repo, so nothing fetched can be kept.")
  const { source, role = "primary", content, mimeType = "text/markdown", name = null, title = null } = opts
  const binary = content instanceof Uint8Array || ArrayBuffer.isView(content)
  const body = binary ? toBytes(content) : String(content ?? "")
  const primaryBytes = binary ? body : new TextEncoder().encode(body)
  const text = opts.text == null ? null : String(opts.text)
  const textVia = text == null ? null : opts.textVia ?? "reader"

  const type = mediaType(mimeType)
  const extension = MIME_EXTENSIONS[type] ?? (binary ? "bin" : "txt")
  const fileName = name ?? sourceName(source, title ?? (binary ? null : titleFrom(body)), extension)
  const readableText = text ?? (binary ? null : body)
  const markdownish = textVia === "reader" || (text == null && type === "text/markdown")
  const marks = opts.marks ?? (markdownish && readableText ? marksFromMarkdown(readableText) : [])

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

/** How a result refers to a kept source, so the model can come back to it. */
export const readOn = (url, offset) => `source_read {source:"${url}", offset:${offset}}`
export const searchIn = (url) => `source_read {source:"${url}", find:"…"}`

/**
 * The lines under an excerpt: how much was shown, how to read on and search,
 * and the outline, so the model can jump to a heading instead of paging.
 */
export function sourceFooter(ref, shown, marks = []) {
  if (!ref) return null
  const total = ref.chars ?? 0
  const lines =
    shown >= total
      ? [`— all ${total} characters shown. Search it later: ${searchIn(ref.url)}.`]
      : [`— ${shown} of ${total} shown. Read on: ${readOn(ref.url, shown)}; search: ${searchIn(ref.url)}.`]
  const map = outline(marks)
  if (map) lines.push(map)
  return lines.join("\n")
}
