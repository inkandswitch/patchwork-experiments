/**
 * Rendering document values for a model to read.
 *
 * Automerge documents contain things that must not go into a prompt verbatim:
 * a file doc's `content` can be megabytes of bytes, and a long text field will
 * happily eat a context window. Everything a tool returns goes through here
 * first, and every elision says what it elided so the model can ask for more
 * rather than silently assuming it saw everything.
 */

import { isBytes, isImmutable } from "./values.js"

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


/**
 * A JSON-ish preview of any document value, with big things summarized.
 * Pure — no automerge, no DOM — so it is directly unit-testable.
 *
 * `opts.more(path, shown)`, given, says how to read the rest of a string cut
 * short — the path to it from `opts.path` (default []), and how much was
 * shown. Without it, a cut string said only how much was missing, and the
 * agent invented ways to get it.
 */
export function preview(value, opts = {}) {
  const o = { ...DEFAULTS, ...opts }

  const walk = (node, depth, path) => {
    if (node === null || node === undefined) return null
    if (isBytes(node)) return `<${node.byteLength ?? node.length} bytes>`
    if (isImmutable(node)) node = String(node)

    const type = typeof node
    if (type === "string") {
      if (node.length <= o.maxString || !o.more) return truncate(node, o.maxString)
      return `${node.slice(0, o.maxString)}… [+${node.length - o.maxString} more chars: ${o.more(path, o.maxString)}]`
    }
    if (type === "number" || type === "boolean") return node
    if (type === "function") return "<function>"

    if (depth >= o.maxDepth) return "<…deeper…>"

    if (Array.isArray(node)) {
      const items = node.slice(0, o.maxItems).map((item, i) => walk(item, depth + 1, [...path, i]))
      if (node.length > o.maxItems) items.push(`… [+${node.length - o.maxItems} more items]`)
      return items
    }

    if (type === "object") {
      const out = {}
      for (const [key, val] of Object.entries(node)) out[key] = walk(val, depth + 1, [...path, key])
      return out
    }

    return String(node)
  }

  return walk(value, 0, o.path ?? [])
}

/**
 * Where two plain values (previews, say) differ: `{ count, changes }`, each
 * change `{ path, before, after }` at the deepest place it can be told apart —
 * a key added or removed, or a value replaced — with at most `max` kept.
 */
export function changesBetween(before, after, max = 8) {
  const changes = []
  let count = 0
  const isTree = (v) => typeof v === "object" && v !== null
  const walk = (a, b, path) => {
    if (a === b) return
    if (isTree(a) && isTree(b) && Array.isArray(a) === Array.isArray(b)) {
      const keys = Array.isArray(a)
        ? Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i)
        : [...new Set([...Object.keys(a), ...Object.keys(b)])]
      for (const key of keys) walk(a[key], b[key], [...path, key])
      return
    }
    count++
    if (changes.length < max) changes.push({ path, before: a, after: b })
  }
  walk(before, after, [])
  return { count, changes }
}

/** A preview rendered as pretty JSON, with a hard ceiling on total size. */
export function previewJson(value, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const text = JSON.stringify(preview(value, o), null, 2) ?? "null"
  if (text.length <= o.maxTotal || !o.narrow) return truncate(text, o.maxTotal)
  return `${text.slice(0, o.maxTotal)}… [+${text.length - o.maxTotal} more chars: ${o.narrow}]`
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

/**
 * The error for a call that names no document in a session attached to none.
 * A workflow step is told it has none of its own — the orchestrator gives a
 * step one with `subject` — so it passes the URL rather than looking for one.
 */
export function noDocumentError(ctx) {
  let step = false
  try {
    step = Boolean(ctx?.session?.doc?.()?.workflow)
  } catch {
    /* no session to ask */
  }
  return new Error(
    step
      ? "Pass `url` (the document's automerge: URL) on every call: this step has no document of its own."
      : "This session is not attached to a document, so say which one: pass `url` (its automerge: URL) on every call."
  )
}
