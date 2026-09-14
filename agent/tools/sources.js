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
export async function saveSource(ctx, { url, content, name, mimeType = "text/markdown" }) {
  if (!ctx?.repo?.create2) return null
  const text = String(content ?? "")
  if (!text) return null

  const extension = MIME_EXTENSIONS[mimeType] ?? "txt"
  const fileName = name ?? sourceName(url, titleFrom(text), extension)

  try {
    const handle = await ctx.repo.create2()
    handle.change((doc) => {
      doc.name = fileName
      doc.extension = extension
      doc.mimeType = mimeType
      doc.content = text
      doc.source = url
      doc.fetchedAt = Date.now()
      doc["@patchwork"] = { type: "file" }
    })
    return { url: handle.url, name: fileName, bytes: text.length, mimeType }
  } catch {
    // A fetch that worked must not be reported as a failure because the
    // document could not be written.
    return null
  }
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
