/**
 * Rendering document values for a model to read.
 *
 * Automerge documents contain things that must not go into a prompt verbatim:
 * a file doc's `content` can be megabytes of bytes, and a long text field will
 * happily eat a context window. Everything a tool returns goes through here
 * first, and every elision says what it elided so the model can ask for more
 * rather than silently assuming it saw everything.
 */

export const DEFAULTS = {
  maxString: 2000,
  maxItems: 200,
  maxDepth: 8,
  maxTotal: 24000,
}

export function truncate(text, max) {
  const str = String(text ?? "")
  if (str.length <= max) return str
  return `${str.slice(0, max)}… [+${str.length - max} more chars]`
}

function isBytes(value) {
  return (
    value instanceof Uint8Array ||
    (typeof value === "object" &&
      value !== null &&
      ArrayBuffer.isView(value) &&
      typeof value.byteLength === "number")
  )
}

/**
 * A JSON-ish preview of any document value, with big things summarized.
 * Pure — no automerge, no DOM — so it is directly unit-testable.
 */
export function preview(value, opts = {}) {
  const o = { ...DEFAULTS, ...opts }

  const walk = (node, depth) => {
    if (node === null || node === undefined) return null
    if (isBytes(node)) return `<${node.byteLength ?? node.length} bytes>`

    const type = typeof node
    if (type === "string") return truncate(node, o.maxString)
    if (type === "number" || type === "boolean") return node
    if (type === "function") return "<function>"

    if (depth >= o.maxDepth) return "<…deeper…>"

    if (Array.isArray(node)) {
      const items = node.slice(0, o.maxItems).map((item) => walk(item, depth + 1))
      if (node.length > o.maxItems) items.push(`… [+${node.length - o.maxItems} more items]`)
      return items
    }

    if (type === "object") {
      const out = {}
      for (const [key, val] of Object.entries(node)) out[key] = walk(val, depth + 1)
      return out
    }

    return String(node)
  }

  return walk(value, 0)
}

/** A preview rendered as pretty JSON, with a hard ceiling on total size. */
export function previewJson(value, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const text = JSON.stringify(preview(value, o), null, 2) ?? "null"
  return truncate(text, o.maxTotal)
}

/** Human-readable byte size, for one-line call summaries. */
export function bytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The shape of a document, for orienting without dumping it: keys and types. */
export function shape(value, depth = 0) {
  if (value === null || value === undefined) return "null"
  if (isBytes(value)) return `bytes(${value.byteLength ?? value.length})`
  if (Array.isArray(value)) {
    if (!value.length) return "[]"
    return depth >= 2 ? `array(${value.length})` : `[${shape(value[0], depth + 1)} ×${value.length}]`
  }
  const type = typeof value
  if (type !== "object") return type === "string" ? `string(${value.length})` : type
  if (depth >= 3) return "object"
  const entries = Object.entries(value).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`)
  return `{ ${entries.join(", ")} }`
}
