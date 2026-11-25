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
 *                  engine: "raw"|"reader-markdown"|"reader-text"|"reader-dom",
 *                  status, contentType, sha256, bytes, readerCache }
 *   content      the primary: Uint8Array for bytes, ImmutableString for text
 *   role         "primary" (the response itself) | "extract" (the reader's text)
 *   text         ImmutableString | null — readable text beside the primary
 *   textVia      "reader" | "html-to-text" | null
 *   marks        [{ at, label }] — headings, as offsets into readable(doc)
 *   pages        null until page offsets exist
 *   missing      null | { what: "pdf" | "primary", outcome, detail } — what we could not keep
 *
 * A web snapshot — made by the Web snapshot package's web_capture, a plugin
 * the agent runs when that package is installed — carries the same contract,
 * with `html` (the frozen page) as its primary instead of `content` and
 * engine "reader-dom" or "raw", so source_read reads one like any kept source.
 */

import { Automerge } from "../host/modules.js"
import { MIME_EXTENSIONS, marksFromMarkdown, mediaType, outline, sha256Hex, sourceName, titleFrom } from "../documents/media.js"

const { ImmutableString } = Automerge

/** The session document, when this runner gives its tools one (a research step's does not). */
export function sessionDoc(ctx) {
  try {
    return ctx?.session?.doc?.() ?? null
  } catch {
    return null
  }
}

/**
 * What this session can see it has kept, newest first: in a research step the
 * workflow's ledger (every step's sources, kernel/scope.js), and otherwise what the
 * session recorded in `made`, which is why recordArtifact keeps `source`,
 * `engine`, `chars` and `what`. The Web snapshot package's web_capture reads
 * `made` the same way, from the session its context carries — and in a
 * research step, the ledger, through its scoped repo's `sources()`.
 */
export function keptSources(ctx) {
  if (ctx?.scope) return ctx.repo.sources().filter((entry) => entry.kind === "source")
  return (sessionDoc(ctx)?.made ?? []).filter((entry) => entry.source)
}

/**
 * The newest kept source of `source` by one of `engines` that has text to
 * read, or null. A copy with no text (a PDF's bytes kept without the reader's
 * text) cannot answer a request to read the page, so it never does.
 */
export async function findKept(ctx, { source, engines }) {
  return keptSources(ctx).find((entry) => entry.source === source && engines.includes(entry.engine) && entry.chars != null) ?? null
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
  lines.push(`Cite what it says as [label](${ref.url} "the exact words").`)
  return lines.join("\n")
}
