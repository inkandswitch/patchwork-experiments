/**
 * The text and the value of things in a document.
 *
 * A document holds strings, ImmutableStrings (text written once, whole),
 * bytes, numbers, booleans, null, counters, dates, lists and maps. What a tool
 * wants from one is most often its text, and this is the one place that says
 * which values hold text and what that text is:
 *
 *   textOf       a string's or an ImmutableString's text; null for anything else
 *   textForm     the same, with a list of strings read as lines, and the form
 *                the text is held in, for writing it back the same way
 *   isLines      is this list shaped like text split at its newlines
 *   contentText  a file's content as text, bytes decoded; "" when it holds none
 *   decodeUtf8   bytes as UTF-8, or null when they are not UTF-8
 *   decodeIfText the same, and null when there is a NUL in them
 *   searchText   any value as text to search: its text, else its JSON
 *   valueAt      the value at a path, or undefined when the path leads nowhere
 *
 * Nothing here imports automerge: an ImmutableString is recognised by the
 * symbol automerge registers for it, so one from the host's copy counts too.
 */

const IMMUTABLE = Symbol.for("_am_immutableString")

/** An ImmutableString, from this automerge or the host's. */
export const isImmutable = (value) => typeof value === "object" && value !== null && value[IMMUTABLE] === true

/** Bytes: automerge holds them as a Uint8Array, and any view is read as the bytes under it. */
export const isBytes = (value) => typeof value === "object" && value !== null && ArrayBuffer.isView(value)

/** An automerge counter. */
export function isCounter(value) {
  return value !== null && typeof value === "object" && typeof value.increment === "function" && typeof value.value === "number"
}

/**
 * Plain maps: automerge's map proxies and JSON objects. Not lists, counters,
 * dates, bytes or ImmutableStrings, which are objects too.
 */
export function isMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** What a path can step into: a list or a map. */
export const isContainer = (value) => Array.isArray(value) || isMap(value)

// ---------------------------------------------------------------- text

/** The text a string or an ImmutableString holds; null for every other value. */
export function textOf(value) {
  if (typeof value === "string") return value
  if (isImmutable(value)) return String(value)
  return null
}

/**
 * The text a value holds and the form it holds it in, `{ form, text }`, or
 * null when it holds none. Forms are "string", "immutable" and "lines": a list
 * counts when every item is text, joined as it is (notebooks keep source as
 * lines that end in their newlines). Any such list counts, the empty one
 * included, because a caller asking for this has said it means text (an op's
 * `text`); doc_read, which has to guess, also asks isLines.
 */
export function textForm(value) {
  if (typeof value === "string") return { form: "string", text: value }
  if (isImmutable(value)) return { form: "immutable", text: String(value) }
  if (Array.isArray(value) && value.every((item) => textOf(item) != null)) {
    return { form: "lines", text: value.map(textOf).join("") }
  }
  return null
}

/**
 * Is this list text split at its newlines: two or more items, each text, and
 * each but the last ending in "\n"? A list of tags is a list; a cell's source
 * is text. This is the guess a reader makes before showing a list as text.
 */
export function isLines(value) {
  return (
    Array.isArray(value) &&
    value.length > 1 &&
    value.every((item, i) => {
      const text = textOf(item)
      return text != null && (i === value.length - 1 || text.endsWith("\n"))
    })
  )
}

/** Bytes as UTF-8 text, or null when they are not UTF-8 (or not bytes). */
export function decodeUtf8(bytes) {
  if (!isBytes(bytes)) return null
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Bytes as UTF-8 text, or null when they are not text: invalid UTF-8, or a NUL in them. */
export function decodeIfText(bytes) {
  const text = decodeUtf8(bytes)
  return text == null || text.includes("\u0000") ? null : text
}

/**
 * A file's content as text. Content is a string, an ImmutableString, or bytes;
 * bytes are decoded as UTF-8 with any invalid sequence replaced, since a
 * reader of a file wants its text whatever arrived. Anything else, and no
 * content at all, holds no text: "".
 */
export function contentText(content) {
  const text = textOf(content)
  if (text != null) return text
  if (isBytes(content)) return new TextDecoder("utf-8", { fatal: false }).decode(content)
  return ""
}

/**
 * Any value as text to search: text as itself, bytes as nothing (their
 * numbers are not words), missing as nothing, and anything else as its JSON,
 * so a pattern can find a value inside a map or a list.
 */
export function searchText(value) {
  if (value === undefined || isBytes(value)) return ""
  const text = textOf(value)
  if (text != null) return text
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------- paths

/**
 * The value at `path` under `root`, or undefined when the path leads nowhere.
 * A path steps into lists and maps only: a list by a whole-number index (a
 * string of digits counts), a map by key. Stepping into anything else, text
 * and bytes included, leads nowhere. documents/ops.js has the same walk that
 * says, instead, where a path stops.
 */
export function valueAt(root, path = []) {
  let node = root
  for (const step of path) {
    if (Array.isArray(node)) {
      const index = typeof step === "string" && /^\d+$/.test(step) ? Number(step) : step
      if (!Number.isInteger(index) || index < 0) return undefined
      node = node[index]
    } else if (isMap(node)) {
      node = Object.prototype.hasOwnProperty.call(node, String(step)) ? node[String(step)] : undefined
    } else {
      return undefined
    }
  }
  return node
}
