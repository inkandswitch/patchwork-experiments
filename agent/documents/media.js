/**
 * What a fetched response is: its media type, its text when it has one, a name
 * for it, and the outline of its headings.
 */

import { textOf } from "./values.js"

export const MIME_EXTENSIONS = {
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
 * result. Encoding text as bytes loses nothing. documents/files.js keeps a
 * wider list for files, which it reads as text only when the bytes decode.
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
 * Formats a person would recognise, by their magic number:
 * `[bytes, name, offset?]`. A model that asked for a wasm module needs some
 * way to tell that it got one, and `00 61 73 6d` is `\0asm` and nothing else
 * is. A WebP is a RIFF file whose form type at byte 8 is "WEBP", and an AVIF
 * an ISO media file whose first box at byte 4 is "ftypavif". (The Web snapshot
 * package keeps its own copy of this table for its capture pipeline.)
 */
export const MAGIC = [
  [[0x00, 0x61, 0x73, 0x6d], "WebAssembly module"],
  [[0x1f, 0x8b], "gzip"],
  [[0x50, 0x4b, 0x03, 0x04], "zip"],
  [[0x25, 0x50, 0x44, 0x46], "PDF"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x47, 0x49, 0x46, 0x38], "GIF"],
  [[0x57, 0x45, 0x42, 0x50], "WebP", 8],
  [[0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], "AVIF", 4],
  [[0x00, 0x00, 0x01, 0x00], "ICO"],
  [[0x77, 0x4f, 0x46, 0x46], "WOFF"],
  [[0x77, 0x4f, 0x46, 0x32], "WOFF2"],
  [[0x00, 0x01, 0x00, 0x00], "TrueType font"],
  [[0x4f, 0x54, 0x54, 0x4f], "OpenType font"],
  [[0x74, 0x74, 0x63, 0x66], "font collection"],
]

/** The format's name, from its magic number, or null. */
export function formatOf(bytes) {
  const head = [...(bytes?.subarray?.(0, 16) ?? [])]
  return MAGIC.find(([magic, , at = 0]) => magic.every((byte, i) => head[at + i] === byte))?.[1] ?? null
}

/** The first few bytes, as hex, with the format named when we recognise it. */
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

/**
 * The text every reader of a kept source reads: `text` when there is one,
 * else the content when the content is text, else null (bytes and nothing
 * readable beside them).
 */
export function readable(doc) {
  if (!doc) return null
  const text = textOf(doc.text)
  if (text != null) return text
  return textOf(doc.content)
}

/** Hex SHA-256 of some bytes, for telling one kept response from another. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** The most headings a kept source records. */
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
