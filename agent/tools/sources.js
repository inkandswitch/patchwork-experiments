/**
 * Outside content becomes a document, not just a paragraph in a prompt.
 *
 * A fetched page used to exist only as text inside a tool result: it cost
 * context on every subsequent turn, a person could not open it, and nothing
 * could link to it. Writing it to its own document fixes all three — the
 * transcript carries a link, Patchwork can render the markdown, `doc_read` can
 * re-read a slice of it later, and the model still gets the excerpt it asked
 * for inline.
 *
 * Deliberately not filed anywhere. These are conversation artifacts: a snapshot
 * of what a URL said at a moment, reachable from the turn that fetched it.
 * `web_import` is the tool for "keep this, put it in my folders" — the two have
 * different jobs and should not silently become the same one.
 *
 * Saving is best-effort on purpose. A runner without a repo, or a repo that
 * refuses the write, must degrade to the old behaviour — inline text — rather
 * than turning a successful fetch into a failed call.
 */

/** Below this, the whole thing is already in the transcript; a document adds nothing. */
export const SPILL_AT = 2000

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
 * Media types that are text however they are spelled.
 *
 * Everything else is treated as bytes. That is the safe way round: decoding
 * bytes as UTF-8 silently replaces every invalid sequence with U+FFFD, which
 * destroys the data and leaves something that still looks like a successful
 * result. Encoding text as bytes loses nothing.
 */
const TEXT_TYPES = /^text\/|^application\/(json|xml|javascript|ecmascript|x-ndjson|graphql)|\+json$|\+xml$/i

/** Does this response carry text, or bytes? */
export function isTextResponse(contentType, bytes) {
  const type = String(contentType ?? "").split(";")[0].trim().toLowerCase()
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
const MAGIC = [
  [[0x00, 0x61, 0x73, 0x6d], "WebAssembly module"],
  [[0x1f, 0x8b], "gzip"],
  [[0x50, 0x4b, 0x03, 0x04], "zip"],
  [[0x25, 0x50, 0x44, 0x46], "PDF"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x47, 0x49, 0x46, 0x38], "GIF"],
]

export function describeBytes(bytes) {
  const head = [...bytes.subarray(0, 8)]
  const hex = head.map((b) => b.toString(16).padStart(2, "0")).join(" ")
  const known = MAGIC.find(([magic]) => magic.every((byte, i) => head[i] === byte))
  return known ? `${hex} — ${known[1]}` : hex
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
 * Write fetched content to its own document.
 *
 * Returns a reference the result block can carry, or null when there is no repo
 * to write to — the caller falls back to plain inline text.
 */
export async function saveSource(ctx, { url, content, name, mimeType = "text/markdown", folder = null }) {
  if (!ctx?.repo?.create2) return null

  // Bytes stay bytes. A Patchwork file document holds either a string or a
  // Uint8Array, and which one it holds is what makes it a text file or a
  // binary one — so this must not helpfully stringify anything.
  const binary = content instanceof Uint8Array || ArrayBuffer.isView(content)
  const body = binary ? toBytes(content) : String(content ?? "")
  const size = binary ? body.byteLength : body.length
  if (!size) return null

  const guessed = MIME_EXTENSIONS[String(mimeType).split(";")[0].trim().toLowerCase()]
  const extension = guessed ?? (binary ? "bin" : "txt")
  const fileName = name ?? sourceName(url, binary ? null : titleFrom(body), extension)

  try {
    const handle = await ctx.repo.create2()
    handle.change((doc) => {
      doc.name = fileName
      doc.extension = extension
      doc.mimeType = mimeType
      doc.content = body
      doc.source = url
      doc.fetchedAt = Date.now()
      doc["@patchwork"] = { type: "file" }
    })

    // File it, when asked. An unfiled document is reachable from the transcript
    // and nowhere else, which is right for something you read once and wrong
    // for something you fetched in order to put in a package.
    if (folder) {
      const into = await ctx.repo.find(folder)
      into.change((doc) => {
        if (!doc.docs) doc.docs = []
        doc.docs.push({ name: fileName, type: "file", url: handle.url })
      })
    }

    return { url: handle.url, name: fileName, bytes: size, mimeType, binary, folder: folder ?? null }
  } catch {
    // A fetch that worked must not be reported as a failure because the
    // document could not be written.
    return null
  }
}

/** A plain Uint8Array over the same bytes, whatever view arrived. */
function toBytes(view) {
  if (view instanceof Uint8Array) return view
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * The line that tells the model where the rest of the content went.
 *
 * Worth being explicit about the mechanics: the model has the excerpt it asked
 * for, and needs to know that re-reading is cheap and how to do it.
 */
export function sourceFooter(ref, shown) {
  if (!ref) return null
  const complete = shown >= ref.bytes
  return [
    "",
    `— saved as '${ref.name}' at ${ref.url}` +
      (complete ? " (complete)" : ` — ${shown} of ${ref.bytes} characters shown here`),
    complete
      ? ""
      : `Read on with doc_read { url: "${ref.url}", path: ["content"], offset: ${shown} } rather than fetching the page again.`,
  ]
    .filter((line) => line !== "")
    .join("\n")
}
