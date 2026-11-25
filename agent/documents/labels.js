/** Short, readable names for the things a call acts on: a document, a path within one, a site, a file, an edit. */

/** A document URL, for callers who want to decide how to show it. */
const AUTOMERGE = /^automerge:/

export function isDocUrl(value) {
  return typeof value === "string" && AUTOMERGE.test(value)
}

/** A short, readable stand-in for a document URL. */
export function shortDoc(url, subject = null) {
  if (!isDocUrl(url)) return String(url ?? "")
  if (subject && url === subject) return "this document"
  return `doc ${url.replace(AUTOMERGE, "").slice(0, 6)}`
}

/** `["items", 0, "text"]` -> `/items/0/text`, and `[]` -> the whole document. */
export function pathLabel(path) {
  if (!Array.isArray(path) || !path.length) return null
  return `/${path.join("/")}`
}

/** A host name, or the raw string when it will not parse. */
export function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url ?? "")
  }
}

/** The last segment of a slash-separated path — usually the interesting part. */
export function baseName(path) {
  const parts = String(path ?? "").split("/").filter(Boolean)
  return parts.at(-1) ?? String(path ?? "")
}

/** Describe an edit by the fields it touches, which is the part worth reading. */
export function describeOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return "no changes"
  const names = []
  for (const op of ops.slice(0, 3)) {
    const where = pathLabel(op?.path) ?? "document"
    const anchor = [op?.find, op?.after, op?.before].find((text) => typeof text === "string")
    if (anchor !== undefined) {
      const snippet = anchor.replace(/\s+/g, " ").trim()
      names.push(`${where} “${snippet.length > 18 ? `${snippet.slice(0, 17)}…` : snippet}”`)
    } else names.push(where)
  }
  const more = ops.length - names.length
  return names.join(", ") + (more > 0 ? ` +${more} more` : "")
}

/** `src/tool.js` -> `js`: the language a path's text is in, where a view can colour it. */
export function languageOf(path) {
  const extension = String(path ?? "").split(".").pop()?.toLowerCase()
  return /^(js|jsx|ts|tsx|json|css|html|md|mjs)$/.test(extension ?? "") ? extension : null
}
