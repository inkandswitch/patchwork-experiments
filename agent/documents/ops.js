/**
 * doc_edit's ops: one small vocabulary for every edit to any automerge document.
 *
 *   { op: "set",     path, value | text }          a field or list item
 *   { op: "delete",  path }                        a field or list item
 *   { op: "insert",  path, value }                 path ends at a list index
 *   { op: "insert",  path, before | after, text }  next to an anchor in text
 *   { op: "append" | "prepend", path, value | text }
 *   { op: "replace", path, find, text, all? }      exact text, once or all
 *   { op: "test",    path, value }                 precondition for the rest
 *   `from: { url?, path }` stands in for `text`: the text at that path.
 *
 * Why it is this shape:
 *
 * - `path` names the thing itself, key by key from the root, exactly as
 *   doc_read prints it. There is no container-plus-key split, so there is one
 *   way to name anything, and the path a read shows is the path an edit takes.
 * - No op takes a character offset. A model sees text and line numbers, not
 *   offsets, and an offset read earlier drifts as soon as the text changes.
 *   Text is addressed by anchoring on it (replace `find`, insert `before` or
 *   `after`) or by its ends (append, prepend). Anchors match exactly and must
 *   be unique unless `all` says otherwise, as in the str_replace tools coding
 *   agents use: a guess that lands in the wrong place is an edit nobody asked
 *   for, and the error says where the anchor does occur.
 * - `value` is a value or a list item; `text` is text. That one rule tells a
 *   list of strings (append an item) from a list of lines (append text).
 * - Text is whatever holds text: a string, an ImmutableString, or a list of
 *   strings such as a notebook cell's source. Each is edited as the text it
 *   joins into and written back in its own form: a string by splicing only the
 *   characters that changed, so the edit merges with concurrent typing; a list
 *   of lines by changing only the lines that differ; an ImmutableString, which
 *   cannot be spliced, by writing a new one.
 * - `set` with a value writes only what differs (writeValue), so an object
 *   sent back with one field changed is a one-field change, and merges.
 * - `test` is JSON Patch's (RFC 6902) optimistic-concurrency guard: the whole
 *   edit stops unless the document still holds what the model read.
 * - Long text goes in pieces: set or append to a missing field creates it, so
 *   every piece is the same kind of call, and a call cut off by the model's
 *   output limit is never run. `from` moves text that already exists in a
 *   document (an export, another cell, a version from doc_history) without the
 *   model retyping it.
 * - Every value written is a fresh copy. An object read from a document cannot
 *   be placed in it again ("Cannot create a reference to an existing document
 *   object"), so values are copied deeply on the way in.
 * - All the ops of one call run in one change, and any error abandons it.
 *   Each op reports what it did as a short diff a person can read too.
 *
 * The automerge `splice` is injected rather than imported, so text splices go
 * through the host's automerge, which owns the document. Without one (plain
 * objects in tests) a text edit reassigns the string.
 */

import { Automerge } from "../host/modules.js"

const { ImmutableString, Counter } = Automerge

export class OpError extends Error {}

export const OP_NAMES = ["set", "delete", "insert", "append", "prepend", "replace", "test"]

// ---------------------------------------------------------------- kinds

const IMMUTABLE = Symbol.for("_am_immutableString")

/** An ImmutableString, from this automerge or the host's. */
export const isImmutable = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && value[IMMUTABLE] === true

const isBytes = (value) => typeof value === "object" && value !== null && ArrayBuffer.isView(value)

function isCounter(value) {
  return value !== null && typeof value === "object" && typeof value.increment === "function" && typeof value.value === "number"
}

/**
 * Plain maps: automerge's map proxies and JSON objects. Not lists, counters,
 * dates, bytes or ImmutableStrings, which are objects too.
 */
function isMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** What a value is, in words, for messages. */
export function kindOf(value) {
  if (value === undefined) return "missing"
  if (value === null) return "null"
  if (typeof value === "string") return "text"
  if (isImmutable(value)) return "text (an ImmutableString)"
  if (Array.isArray(value)) return `a list of ${value.length} item${value.length === 1 ? "" : "s"}`
  if (isBytes(value)) return `${value.byteLength} bytes`
  if (isCounter(value)) return "a counter"
  if (value instanceof Date) return "a date"
  if (typeof value === "object") return "a map"
  return `a ${typeof value}`
}

/**
 * The text a value holds, and the form it holds it in, or null when it holds
 * none. A list counts when every item is a string: what an op means by it is
 * said by the op (`text` rather than `value`), never guessed from the list.
 */
export function asText(value) {
  if (typeof value === "string") return { form: "string", text: value }
  if (isImmutable(value)) return { form: "immutable", text: String(value) }
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || isImmutable(item))) {
    return { form: "lines", text: value.map(String).join("") }
  }
  return null
}

/** Text as lines that keep their newlines, the way notebooks store source. join("") undoes it exactly. */
export function splitLines(text) {
  const lines = []
  for (let at = 0; at < text.length; ) {
    const newline = text.indexOf("\n", at)
    const end = newline === -1 ? text.length : newline + 1
    lines.push(text.slice(at, end))
    at = end
  }
  return lines
}

/**
 * A deep copy made of fresh values: what a document read gave back (proxies,
 * counters, ImmutableStrings) becomes something that can be written again.
 */
export function plain(value) {
  if (value === null || typeof value !== "object") return value
  if (isImmutable(value)) return new ImmutableString(String(value))
  if (isCounter(value)) return new Counter(value.value)
  if (value instanceof Date) return new Date(value.getTime())
  if (isBytes(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  if (Array.isArray(value)) return value.map(plain)
  const copy = {}
  for (const [key, item] of Object.entries(value)) if (item !== undefined) copy[key] = plain(item)
  return copy
}

// ---------------------------------------------------------------- text

/** 1-based line number of a character offset. */
export function lineOf(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** Every place `needle` starts in `text`, not overlapping. */
export function occurrences(text, needle) {
  const found = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) found.push(at)
  return found
}

/**
 * Where `needle` sits in `text`, or why it cannot be used as an anchor.
 *
 * The rule is exact-match, exactly-once. The error says how many times the
 * text occurs and on which lines, or, when only its first line matches, where
 * that is — so the model can widen or fix the anchor rather than start over.
 */
export function locate(text, needle, name = "find") {
  if (typeof needle !== "string" || !needle.length) throw new OpError(`\`${name}\` must be a non-empty string`)
  const first = text.indexOf(needle)
  if (first === -1) {
    const firstLine = needle.split("\n")[0].trim()
    const near = firstLine && firstLine !== needle ? text.indexOf(firstLine) : -1
    const hint =
      near >= 0
        ? ` Its first line does appear (line ${lineOf(text, near)}), so the rest differs: read that part again and copy it exactly.`
        : " Read the text again and copy the anchor exactly, whitespace included."
    throw new OpError(`\`${name}\` text not found.${hint}`)
  }
  const all = occurrences(text, needle)
  if (all.length > 1) {
    const lines = [...new Set(all.map((at) => lineOf(text, at)))]
    const shown = lines.slice(0, 5).join(", ") + (lines.length > 5 ? ", …" : "")
    const widen = name === "find" ? " Include more of the text around it so it matches one place, or pass all: true." : " Include more of the text around it so it matches one place."
    throw new OpError(`\`${name}\` text occurs ${all.length} times (line${lines.length === 1 ? "" : "s"} ${shown}).${widen}`)
  }
  return first
}

/**
 * The smallest splice that turns `before` into `after`.
 *
 * Trims the common prefix and suffix, so replacing one word in a 20 kB text is
 * a splice of a few characters — which is what lets it merge with someone
 * else's concurrent edit elsewhere, and keeps the history readable.
 */
export function minimalSplice(before, after) {
  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }
  return { from: prefix, to: before.length - suffix, inserted: after.slice(prefix, after.length - suffix) }
}

/** `splices` ([{from, to, inserted}], ascending, not overlapping) applied to `text`. */
export function applySplices(text, splices) {
  let out = text
  for (const { from, to, inserted } of [...splices].reverse()) out = out.slice(0, from) + inserted + out.slice(to)
  return out
}

/** The text edits, shared with fs_edit. */
export const TEXT_OPS = ["replace", "insert", "append", "prepend"]

/**
 * One text edit, worked out on a plain string: `{ after, splices }`. Shared by
 * doc_edit and fs_edit, so text means the same in a document and in a file.
 *
 *   replace { find, text, all }     each splice is only the characters that differ
 *   insert  { before | after, text }
 *   append  { text }   prepend { text }
 */
export function editText(text, edit) {
  const adding = edit.text ?? ""
  let splices
  if (edit.op === "replace") {
    if (edit.find === adding) throw new OpError("`find` and `text` are the same, so there is nothing to change")
    const positions = edit.all ? occurrences(text, edit.find) : [locate(text, edit.find)]
    if (!positions.length) locate(text, edit.find) // throws, saying why
    const { from, to, inserted } = minimalSplice(edit.find, adding)
    splices = positions.map((at) => ({ from: at + from, to: at + to, inserted }))
  } else if (edit.op === "insert") {
    const name = edit.after != null ? "after" : "before"
    const anchor = edit[name]
    const at = locate(text, anchor, name) + (name === "after" ? anchor.length : 0)
    splices = [{ from: at, to: at, inserted: adding }]
  } else if (edit.op === "append") {
    splices = [{ from: text.length, to: text.length, inserted: adding }]
  } else if (edit.op === "prepend") {
    splices = [{ from: 0, to: 0, inserted: adding }]
  } else {
    throw new OpError(`${edit.op} is not a text edit: use one of ${TEXT_OPS.join(", ")}`)
  }
  return { after: applySplices(text, splices), splices }
}

/**
 * Splice `from..to` of the string at `path`, through automerge's text splice
 * when one is available and by reassignment when not (plain objects, tests).
 */
export function spliceString(draft, path, from, to, inserted, spliceText) {
  if (spliceText) {
    spliceText(draft, path, from, Math.max(0, to - from), inserted)
    return
  }
  const parent = path.slice(0, -1).reduce((node, key) => node[key], draft)
  const key = path[path.length - 1]
  parent[key] = parent[key].slice(0, from) + inserted + parent[key].slice(to)
}

// ---------------------------------------------------------------- diffs

const LINE_CHARS = 160
const HUNK_LINES = 6
const HUNKS = 3

const clip = (line) => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}… [+${line.length - LINE_CHARS} chars]` : line)

/** The whole lines of `text` that `from..to` touches. */
function linesAround(text, from, to) {
  if (!text.length) return []
  const start = text.lastIndexOf("\n", from - 1) + 1
  const last = to > from && text[to - 1] === "\n" ? to - 1 : to
  let end = text.indexOf("\n", Math.max(last, start))
  if (end === -1) end = text.length
  return text.slice(start, end).split("\n")
}

function side(mark, lines) {
  if (lines.length <= HUNK_LINES) return lines.map((line) => `  ${mark} ${clip(line)}`)
  const head = lines.slice(0, HUNK_LINES - 2).map((line) => `  ${mark} ${clip(line)}`)
  return [...head, `  ${mark} … ${lines.length - HUNK_LINES + 1} more lines`, `  ${mark} ${clip(lines.at(-1))}`]
}

const wholeLines = (text) => text === "" || text.endsWith("\n")
const linesIn = (text) => (text === "" ? [] : text.slice(0, -1).split("\n"))

/**
 * The lines one splice took out and put in. Whole lines added or removed at a
 * line start are shown as just those lines; anything else as the whole lines
 * it touched, before and after.
 */
function hunk(before, after, splice, at) {
  const removed = before.slice(splice.from, splice.to)
  const atLineStart = splice.from === 0 || before[splice.from - 1] === "\n"
  if (atLineStart && wholeLines(removed) && wholeLines(splice.inserted)) return [linesIn(removed), linesIn(splice.inserted)]
  return [linesAround(before, splice.from, splice.to), linesAround(after, at, at + splice.inserted.length)]
}

/**
 * What `splices` did to `before`, as a few lines of -/+ under the line each
 * change starts on. Long sides keep their first lines and their last, so an
 * append shows how the text now ends.
 */
export function textDiff(before, after, splices) {
  // Where each splice landed in `after`, then splices on the same lines taken
  // together, so a line changed in two places reads as one change.
  let shift = 0
  const placed = splices.map((splice) => {
    const at = splice.from + shift
    shift += splice.inserted.length - (splice.to - splice.from)
    return { ...splice, at }
  })
  const groups = []
  for (const splice of placed) {
    const last = groups.at(-1)
    if (last && lineOf(before, splice.from) <= lineOf(before, last.to)) {
      last.to = splice.to
      last.end = splice.at + splice.inserted.length
    } else {
      groups.push({ from: splice.from, to: splice.to, at: splice.at, end: splice.at + splice.inserted.length })
    }
  }
  const out = []
  for (const group of groups.slice(0, HUNKS)) {
    const merged = { from: group.from, to: group.to, inserted: after.slice(group.at, group.end) }
    const [removed, added] = hunk(before, after, merged, group.at)
    out.push(`  line ${lineOf(before, group.from)}:`, ...side("-", removed), ...side("+", added))
  }
  if (groups.length > HUNKS) out.push(`  … and ${groups.length - HUNKS} more`)
  return out
}

function forShow(value) {
  if (isImmutable(value)) return String(value)
  if (isCounter(value)) return value.value
  if (isBytes(value)) return `<${value.byteLength} bytes>`
  if (Array.isArray(value)) return value.map(forShow)
  if (isMap(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forShow(v)]))
  return value
}

/** A value, short, for a report line. */
export function brief(value, max = 120) {
  const shown = JSON.stringify(forShow(value)) ?? String(value)
  return shown.length > max ? `${shown.slice(0, max)}…` : shown
}

// ---------------------------------------------------------------- paths

const label = (path) => `/${path.join("/")}`
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`

/** What a container holds, for an error about a path that is not there. */
function contents(node) {
  if (Array.isArray(node)) return node.length ? `it has ${node.length} item${node.length === 1 ? "" : "s"} (0–${node.length - 1}).` : "it is empty."
  const keys = Object.keys(node)
  if (!keys.length) return "it is empty."
  return `it has ${keys.slice(0, 15).join(", ")}${keys.length > 15 ? `, … (${keys.length} keys)` : ""}.`
}

function notThere(path, parent) {
  const above = path.length > 1 ? label(path.slice(0, -1)) : "the document root"
  return `${label(path)} does not exist: ${above} ${contents(parent).replace(/^it /, "")}`
}

/** A path step as the container it applies to wants it: an index for a list, a key for a map. */
function keyFor(container, key, path) {
  if (!Array.isArray(container)) return String(key)
  const index = typeof key === "string" && /^\d+$/.test(key) ? Number(key) : key
  if (!Number.isInteger(index) || index < 0) throw new OpError(`${label(path)}: a list takes a whole-number index, not ${JSON.stringify(key)}`)
  return index
}

const isContainer = (node) => Array.isArray(node) || isMap(node)

/**
 * The container holding the thing at `path`, and the key of the thing in it.
 * Every step before the last must exist; the error says where the path stops
 * and what is there instead.
 */
export function parentOf(root, path) {
  let node = root
  for (let i = 0; i < path.length - 1; i++) {
    const key = keyFor(node, path[i], path.slice(0, i + 1))
    const next = node[key]
    if (next === undefined) throw new OpError(notThere(path.slice(0, i + 1), node))
    if (!isContainer(next)) {
      throw new OpError(`${label(path.slice(0, i + 1))} is ${kindOf(next)}, so it has no ${JSON.stringify(path[i + 1])}`)
    }
    node = next
  }
  return { parent: node, key: keyFor(node, path[path.length - 1], path) }
}

/** The value at `path`, or an OpError saying where the path stops. */
export function valueAt(root, path) {
  if (!path.length) return root
  const { parent, key } = parentOf(root, path)
  if (parent[key] === undefined) throw new OpError(notThere(path, parent))
  return parent[key]
}

// ---------------------------------------------------------------- values

/** Deep equality between what is in the document and a value; text compares as text. */
export function sameValue(current, value) {
  if (current === value) return true
  if (isImmutable(current) || isImmutable(value)) {
    const a = isImmutable(current) ? String(current) : current
    const b = isImmutable(value) ? String(value) : value
    return typeof a === "string" && a === b
  }
  if (isCounter(current)) return current.value === (isCounter(value) ? value.value : value)
  if (current instanceof Date && value instanceof Date) return current.getTime() === value.getTime()
  if (Array.isArray(current) && Array.isArray(value)) {
    return current.length === value.length && value.every((item, i) => sameValue(current[i], item))
  }
  if (isMap(current) && isMap(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined)
    return Object.keys(current).length === keys.length && keys.every((key) => key in current && sameValue(current[key], value[key]))
  }
  return false
}

/** Nothing to write: equal, and not a string standing where an ImmutableString is (or the reverse). */
const unchanged = (current, value) => sameValue(current, value) && isImmutable(current) === isImmutable(value)

/**
 * Make the value at `path` equal `value`, writing only what differs.
 *
 * Assigning a whole value is what the model naturally does — it read the
 * object, changed a field, and sends the object back — and in automerge it is
 * the wrong write: it replaces everything under that key, so anyone else's
 * concurrent edit anywhere inside it is lost, and the history says the whole
 * thing was rewritten. So a set is turned into the edits it implies — a text
 * splice, the changed fields, the inserted items — and the model never has to
 * know. `value` must already be a fresh copy (plain).
 *
 * The invariant is only that the result equals `value`; how little is written
 * to get there is best effort.
 */
export function writeValue(draft, path, value, spliceText = null) {
  const { parent, key } = parentOf(draft, path)
  const current = parent[key]
  if (unchanged(current, value)) return

  if (typeof current === "string" && typeof value === "string") {
    const { from, to, inserted } = minimalSplice(current, value)
    spliceString(draft, path, from, to, inserted, spliceText)
    return
  }

  // A counter merges concurrent increments; setting it to a number would turn
  // it into a plain number that does not.
  if (isCounter(current) && typeof value === "number") {
    current.increment(value - current.value)
    return
  }

  if (isMap(current) && isMap(value)) {
    for (const field of Object.keys(current)) {
      if (!(field in value) || value[field] === undefined) delete current[field]
    }
    for (const [field, next] of Object.entries(value)) {
      if (next === undefined) continue
      if (field in current) writeValue(draft, [...path, field], next, spliceText)
      else current[field] = next
    }
    return
  }

  if (Array.isArray(current) && Array.isArray(value)) {
    // Keep the ends that already match. What is left in the middle is edited
    // in place position by position, so an item with one changed field stays
    // the same item, and only the difference in length is inserted or removed.
    let start = 0
    while (start < current.length && start < value.length && sameValue(current[start], value[start])) start++
    let end = 0
    while (
      end < current.length - start &&
      end < value.length - start &&
      sameValue(current[current.length - 1 - end], value[value.length - 1 - end])
    ) {
      end++
    }
    const oldMiddle = current.length - start - end
    const newMiddle = value.length - start - end
    const paired = Math.min(oldMiddle, newMiddle)
    for (let i = 0; i < paired; i++) writeValue(draft, [...path, start + i], value[start + i], spliceText)
    if (oldMiddle > paired) current.splice(start + paired, oldMiddle - paired)
    if (newMiddle > paired) current.splice(start + paired, 0, ...value.slice(start + paired, start + newMiddle))
    return
  }

  parent[key] = value
}

/**
 * Write `after` over text held in `form` at `path`, keeping the form. A string
 * takes the splices it was edited with, so only those characters change.
 */
function writeText(draft, path, form, after, splices, spliceText) {
  if (form === "string") {
    for (const { from, to, inserted } of [...splices].reverse()) spliceString(draft, path, from, to, inserted, spliceText)
  } else if (form === "immutable") {
    const { parent, key } = parentOf(draft, path)
    parent[key] = new ImmutableString(after)
  } else {
    writeValue(draft, path, splitLines(after), spliceText)
  }
}

// ---------------------------------------------------------------- validation

/** The fields each op takes besides `op` and `path`. */
const FIELDS = {
  set: ["value", "text", "from"],
  delete: [],
  insert: ["value", "text", "from", "before", "after"],
  append: ["value", "text", "from"],
  prepend: ["value", "text", "from"],
  replace: ["find", "text", "from", "all"],
  test: ["value"],
}

const FIELD_HINTS = {
  range: " There is no range: `path` names the thing itself, and text is changed by anchoring on it (replace, insert before/after) or at its ends (append, prepend).",
  find: " `find` belongs to replace.",
  with: " The new text is `text`.",
  replace: " The new text is `text`.",
  old: " Use replace with `find` and `text`.",
  new: " Use replace with `find` and `text`.",
  index: " Put the index at the end of `path`.",
  key: " Put the key at the end of `path`.",
  value: " This op works on text: give `text`.",
  text: " This op works on values: give `value`.",
}

/**
 * Whether an op carries a field. Models fill optional fields they do not use
 * with null, so null counts as absent — except for `value`, where null is a
 * value a document can hold.
 */
const has = (op, field) =>
  field === "value" ? op.value !== undefined && !(op.value === null && (op.text != null || op.from != null)) : op[field] != null

export function validateOp(op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) throw new OpError("each op must be an object like { op: \"set\", path: [\"title\"], value: \"New\" }")
  if (!OP_NAMES.includes(op.op)) {
    throw new OpError(`${op.op == null ? "missing `op`" : `unknown op ${JSON.stringify(op.op)}`}: say which, one of ${OP_NAMES.join(", ")}`)
  }
  const path = op.path ?? []
  if (!Array.isArray(path)) throw new OpError("`path` must be a list of keys and indices, like [\"cells\", 2, \"source\"]")
  for (const key of path) {
    if (typeof key !== "string" && typeof key !== "number") throw new OpError(`path steps are keys (strings) or indices (numbers), not ${JSON.stringify(key)}`)
  }
  for (const field of Object.keys(op)) {
    if (field === "op" || field === "path" || op[field] == null) continue
    if (!FIELDS[op.op].includes(field)) throw new OpError(`${op.op} takes no \`${field}\`.${FIELD_HINTS[field] ?? ""}`)
  }
  if (has(op, "text") && has(op, "from")) throw new OpError("give `text` or `from`, not both")
  if (has(op, "text") && typeof op.text !== "string") throw new OpError("`text` must be a string; for any other value use `value`")
  if (has(op, "from")) {
    const from = op.from
    if (typeof from !== "object" || !Array.isArray(from.path)) throw new OpError("`from` must be { path, url? }: where the text is, in another document if url is given")
    if (from.url != null && typeof from.url !== "string") throw new OpError("`from.url` must be a document URL")
  }
  const textual = has(op, "text") || has(op, "from")

  switch (op.op) {
    case "set":
      if (!path.length) throw new OpError("refusing to replace the whole document: set its fields one by one")
      if (textual === has(op, "value")) throw new OpError("set takes `value` (any value) or `text` (text, written in the form the field already has), one of them")
      break
    case "delete":
      if (!path.length) throw new OpError("refusing to delete the whole document")
      break
    case "insert": {
      const anchors = ["before", "after"].filter((field) => has(op, field))
      if (textual) {
        if (has(op, "value")) throw new OpError("give `text` or `value`, not both")
        if (anchors.length !== 1) throw new OpError("inserting text takes `before` or `after` (one of them): the exact text to insert next to. For the start or end, prepend or append")
        if (typeof op[anchors[0]] !== "string" || !op[anchors[0]].length) throw new OpError(`\`${anchors[0]}\` must be a non-empty string`)
      } else {
        if (!has(op, "value")) throw new OpError("insert takes `value` (an item, with path ending at a list index) or `text` with `before` or `after`")
        if (anchors.length) throw new OpError(`\`${anchors[0]}\` anchors text: give \`text\`, not \`value\``)
      }
      break
    }
    case "append":
    case "prepend":
      if (textual === has(op, "value")) throw new OpError(`${op.op} takes \`value\` (an item, for a list) or \`text\` (text, for text), one of them`)
      break
    case "replace":
      if (typeof op.find !== "string" || !op.find.length) throw new OpError("replace takes `find`: the exact text to replace, copied from a read")
      if (op.all != null && typeof op.all !== "boolean") throw new OpError("`all` is true or false")
      break
    case "test":
      if (!has(op, "value")) throw new OpError("test takes `value`: what `path` must hold for the edit to go ahead")
      break
  }
  return true
}

// ---------------------------------------------------------------- ops

/** The text an op brings: its `text`, or what `from` points at. */
function textOfOp(draft, op, read) {
  if (!has(op, "from")) return op.text ?? ""
  const where = `${op.from.url ? `${op.from.url} ` : ""}${label(op.from.path)}`
  let source
  try {
    source = read(op.from, draft)
  } catch (err) {
    throw new OpError(`from ${where}: ${err.message}`)
  }
  if (isBytes(source)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(source)
    } catch {
      throw new OpError(`from ${where}: those bytes are not UTF-8 text`)
    }
  }
  const text = asText(source)
  if (!text) throw new OpError(`from ${where}: it is ${kindOf(source)}, not text`)
  return text.text
}

const readHere = (from, draft) => {
  if (from.url) throw new OpError("this edit cannot read other documents")
  return valueAt(draft, from.path)
}

function testOp(draft, path, value) {
  let current
  try {
    current = valueAt(draft, path)
  } catch (err) {
    throw new OpError(`test failed: ${err.message}`)
  }
  if (!sameValue(current, value)) {
    throw new OpError(`test failed: ${label(path)} is ${brief(current)}, not ${brief(value)}. It changed since you read it: read it again and decide afresh.`)
  }
  return `test ${label(path)}: ok`
}

function setValue(draft, path, value, spliceText) {
  const { parent, key } = parentOf(draft, path)
  if (Array.isArray(parent) && key >= parent.length) {
    throw new OpError(`${label(path)} is past the end of ${label(path.slice(0, -1))}, which has ${parent.length} item${parent.length === 1 ? "" : "s"}. To add one, append, or insert at index ${parent.length}.`)
  }
  const current = parent[key]
  if (current === undefined) {
    parent[key] = value
    return `set ${label(path)}: ${brief(value)} (new)`
  }
  if (unchanged(current, value)) return `set ${label(path)}: already ${brief(value)}, nothing written`
  if (typeof current === "string" && typeof value === "string") {
    const splice = minimalSplice(current, value)
    writeValue(draft, path, value, spliceText)
    return [`set ${label(path)}:`, ...textDiff(current, value, [splice])].join("\n")
  }
  const was = brief(current)
  writeValue(draft, path, value, spliceText)
  return `set ${label(path)}: ${was} → ${brief(value)}`
}

const FORM_NOTE = { string: "", immutable: " (an ImmutableString, written anew)", lines: " (a list of lines)" }

function textEdit(draft, path, op, { spliceText, read }) {
  if (!path.length) throw new OpError("the document root is a map, not text: give the path of the text")
  const adding = textOfOp(draft, op, read)
  const { parent, key } = parentOf(draft, path)
  const current = parent[key]

  if (current === undefined) {
    // A missing field is empty text to these, so every piece of a long text,
    // the first included, is the same kind of call.
    if (Array.isArray(parent) || !["set", "append", "prepend"].includes(op.op)) throw new OpError(notThere(path, parent))
    parent[key] = adding
    return `${op.op} ${label(path)}: new text, ${count(adding.length, "char")} in ${count(splitLines(adding).length, "line")}`
  }

  const held = asText(current)
  if (!held) {
    const hint = Array.isArray(current) ? " To add an item to a list, give `value` instead of `text`." : isBytes(current) ? " For a file, use fs_edit." : " To replace it with text, set it with `value`."
    throw new OpError(`${label(path)} is ${kindOf(current)}, not text.${hint}`)
  }

  const { after, splices } =
    op.op === "set" ? { after: adding, splices: [minimalSplice(held.text, adding)] } : editText(held.text, { ...op, text: adding })
  if (after === held.text) return `${op.op} ${label(path)}: the text is already so, nothing written`
  writeText(draft, path, held.form, after, splices, spliceText)

  const where = `${op.op} ${label(path)}${FORM_NOTE[held.form]}`
  let head = `${where}:`
  if (op.op === "replace" && splices.length > 1) {
    const lines = [...new Set(splices.map((s) => lineOf(held.text, s.from)))]
    head = `${where}: ${splices.length} places (line${lines.length === 1 ? "" : "s"} ${lines.slice(0, 8).join(", ")}${lines.length > 8 ? ", …" : ""})`
  } else if (op.op === "append" || op.op === "prepend") {
    head = `${where}: +${count(adding.length, "char")}; now ${count(splitLines(after).length, "line")}, ${count(after.length, "char")}`
  }
  return [head, ...textDiff(held.text, after, splices)].join("\n")
}

function deleteAt(draft, path) {
  const { parent, key } = parentOf(draft, path)
  const current = parent[key]
  if (current === undefined) throw new OpError(`${notThere(path, parent)} Nothing to delete.`)
  if (Array.isArray(parent)) parent.splice(key, 1)
  else delete parent[key]
  return `delete ${label(path)} (was ${brief(current)})`
}

function insertItem(draft, path, value) {
  if (!path.length) throw new OpError("insert's path ends at a list index: [\"items\", 2] inserts before item 2")
  const { parent, key } = parentOf(draft, path)
  if (!Array.isArray(parent)) {
    throw new OpError(`${path.length > 1 ? label(path.slice(0, -1)) : "the document root"} is ${kindOf(parent)}, not a list: insert's path ends at a list index. To add a field, set it.`)
  }
  if (key > parent.length) {
    throw new OpError(`index ${key} is past the end of ${label(path.slice(0, -1))}, which has ${parent.length} item${parent.length === 1 ? "" : "s"}: insert at 0–${parent.length}, or append.`)
  }
  parent.splice(key, 0, value)
  return `insert ${label(path)}: ${brief(value)}; the list now has ${count(parent.length, "item")}`
}

function addItem(draft, path, op, value) {
  if (!path.length) throw new OpError("the document root is a map, not a list: give the path of the list")
  const { parent, key } = parentOf(draft, path)
  const list = parent[key]
  if (list === undefined) {
    if (Array.isArray(parent)) throw new OpError(notThere(path, parent))
    parent[key] = [value]
    return `${op.op} ${label(path)}: new list, ${brief(value)}`
  }
  if (!Array.isArray(list)) {
    const hint = asText(list) ? " To add text to it, give `text` instead of `value`." : ""
    throw new OpError(`${label(path)} is ${kindOf(list)}, not a list.${hint}`)
  }
  const at = op.op === "append" ? list.length : 0
  list.splice(at, 0, value)
  return `${op.op} ${label([...path, at])}: ${brief(value)}; the list now has ${count(list.length, "item")}`
}

/**
 * Apply one op to a mutable automerge draft (or a plain object, in tests), and
 * say what it did. Run it inside `handle.change(...)`: a throw abandons the
 * change. `read(from, draft)` resolves a `from`; by default only paths in this
 * document, as they stand when the op runs.
 */
export function applyOp(draft, op, { spliceText = null, read = readHere } = {}) {
  validateOp(op)
  const path = op.path ?? []
  const textual = has(op, "text") || has(op, "from")
  switch (op.op) {
    case "test":
      return testOp(draft, path, op.value)
    case "delete":
      return deleteAt(draft, path)
    case "replace":
      return textEdit(draft, path, op, { spliceText, read })
    case "set":
      return textual ? textEdit(draft, path, op, { spliceText, read }) : setValue(draft, path, plain(op.value), spliceText)
    case "insert":
      return textual ? textEdit(draft, path, op, { spliceText, read }) : insertItem(draft, path, plain(op.value))
    default:
      return textual ? textEdit(draft, path, op, { spliceText, read }) : addItem(draft, path, op, plain(op.value))
  }
}

/** What an op is about, for an error: `op 2 (replace /body)`. */
export function opLabel(op, index) {
  const path = Array.isArray(op?.path) ? label(op.path) : "?"
  return `op ${index + 1} (${typeof op?.op === "string" ? op.op : "?"} ${path})`
}

/**
 * Apply ops in order, collecting their reports. The first that fails throws an
 * OpError naming it, so the caller's change is abandoned whole.
 */
export function applyOps(draft, ops, options) {
  const done = []
  ops.forEach((op, i) => {
    try {
      done.push(applyOp(draft, op, options))
    } catch (err) {
      const message = err instanceof OpError ? err.message : `${err.message} (read the document again: the path may not be what you expect)`
      throw new OpError(`${opLabel(op, i)}: ${message}`, { cause: err })
    }
  })
  return done
}
