/**
 * One vocabulary for every edit to any automerge document.
 *
 *   path   (string|number)[]   keys/indices from the doc root to the thing you
 *                              are touching. [] is the root.
 *   range  [from, to] | key    an array => SPLICE: replace elements from..to
 *                              (characters if the target is a string, items if
 *                              it is a list). A key => ASSIGN that key, or
 *                              DELETE it when no value is supplied.
 *   find   string              on a string target: the exact text to replace
 *                              with `value`. It must occur exactly once. The
 *                              splice range is computed here, so the model
 *                              never has to count characters.
 *   value  any                 what to insert or set.
 *
 * Giving the model one edit verb instead of a per-datatype tool per document
 * shape is what makes "edit any document" tractable: the same call edits a
 * board, a recipe, a folder, or a file's text.
 *
 * The automerge `splice` function is injected rather than imported so this
 * module stays unit-testable in node, where the importmap does not exist.
 * Without it, text edits fall back to reassigning the whole string — correct,
 * but it loses concurrent-edit merging, so real callers always pass it.
 */

export class OpError extends Error {}

// ---------------------------------------------------------------- anchoring

/**
 * Where `find` sits in `text`, or why it cannot be used as an anchor.
 *
 * The rule is exact-match, exactly-once. Fuzzy matching would make the tool
 * guess, and a guess that lands in the wrong place is an edit nobody asked for.
 * The error says how many times the text occurs and where, so the model can
 * widen the anchor rather than start over.
 */
export function locate(text, find) {
  if (typeof find !== "string" || !find.length) throw new OpError("`find` must be a non-empty string")
  const first = text.indexOf(find)
  if (first === -1) {
    const firstLine = find.split("\n")[0].trim()
    const near = firstLine && firstLine !== find ? text.indexOf(firstLine) : -1
    const hint =
      near >= 0
        ? ` Its first line does appear (around line ${lineOf(text, near)}), so the rest differs — re-read that part and copy it exactly.`
        : " Re-read the text and copy the anchor exactly, whitespace included."
    throw new OpError(`\`find\` text not found.${hint}`)
  }
  const second = text.indexOf(find, first + 1)
  if (second !== -1) {
    const lines = []
    let count = 0
    for (let at = first; at !== -1; at = text.indexOf(find, at + 1)) {
      count++
      const line = lineOf(text, at)
      if (lines.length < 5 && !lines.includes(line)) lines.push(line)
    }
    throw new OpError(
      `\`find\` text occurs ${count} times (line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}${count > 5 ? ", …" : ""}). Include more surrounding text so it matches exactly one place.`
    )
  }
  return first
}

/** 1-based line number of a character offset. */
export function lineOf(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * The smallest splice that turns `before` into `after`.
 *
 * Trims the common prefix and suffix, so replacing one word in a 20 kB file is
 * a splice of a few characters — which is what lets the change merge with
 * someone else's concurrent edit elsewhere in the file, and keeps the
 * document's history readable. Reassigning the whole string is neither.
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
  return {
    from: prefix,
    to: before.length - suffix,
    inserted: after.slice(prefix, after.length - suffix),
  }
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
  const { parent, key } = parentOf(draft, path)
  if (!parent) throw new OpError("cannot splice the document root as text")
  const target = parent[key]
  parent[key] = target.slice(0, from) + inserted + target.slice(to)
}

function nodeAt(root, path) {
  let node = root
  for (const key of path) {
    if (node == null) return undefined
    node = node[key]
  }
  return node
}

/** The container holding the thing at `path`, plus the final step to reach it. */
function parentOf(root, path) {
  if (!path.length) return { parent: null, key: null }
  const parent = nodeAt(root, path.slice(0, -1))
  return { parent, key: path[path.length - 1] }
}

// ---------------------------------------------------------------- setting

/**
 * Plain maps: automerge's map proxies and JSON objects. Not lists, counters,
 * dates, bytes or ImmutableStrings, which are objects too.
 */
function isMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isCounter(value) {
  return value !== null && typeof value === "object" && typeof value.increment === "function" && typeof value.value === "number"
}

/** Deep equality between what is in the document and a JSON value. */
export function sameValue(current, value) {
  if (current === value) return true
  if (isCounter(current)) return current.value === value
  if (Array.isArray(current) && Array.isArray(value)) {
    return current.length === value.length && value.every((item, i) => sameValue(current[i], item))
  }
  if (isMap(current) && isMap(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined)
    return Object.keys(current).length === keys.length && keys.every((key) => key in current && sameValue(current[key], value[key]))
  }
  return false
}

/**
 * Make the value at `path` equal `value`, writing only what differs.
 *
 * Assigning a whole value is what the model naturally does — it read the
 * object, changed a field, and sends the object back — and in automerge it is
 * the wrong write: it replaces everything under that key, so anyone else's
 * concurrent edit anywhere inside it is lost, and the history says the whole
 * thing was rewritten. Measured: a list reassigned while another peer pushed
 * to it came out without the push. So a set is turned into the edits it
 * implies — a text splice, the changed fields, the inserted items — and the
 * model never has to know.
 *
 * The invariant is only that the result equals `value`; how little is written
 * to get there is best effort.
 */
export function writeValue(draft, path, value, spliceText = null) {
  const { parent, key } = parentOf(draft, path)
  const current = parent[key]
  if (sameValue(current, value)) return

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

export function validateOp(op) {
  if (!op || typeof op !== "object") throw new OpError("op must be an object")
  const path = op.path ?? []
  if (!Array.isArray(path)) throw new OpError("path must be an array")
  for (const key of path) {
    if (typeof key !== "string" && typeof key !== "number") {
      throw new OpError(`path segments must be strings or numbers, got ${typeof key}`)
    }
  }
  if (op.find !== undefined && op.find !== null) {
    if (typeof op.find !== "string" || !op.find.length) throw new OpError("`find` must be a non-empty string")
    if (op.range !== undefined && op.range !== null) throw new OpError("give `find` or `range`, not both")
    if (op.value !== undefined && op.value !== null && typeof op.value !== "string") {
      throw new OpError("with `find`, `value` must be the replacement text (a string), or omitted to delete the text")
    }
  }
  if (op.range !== undefined && op.range !== null && Array.isArray(op.range)) {
    const [from, to] = op.range
    if (typeof from !== "number" || (to !== undefined && typeof to !== "number")) {
      throw new OpError("a splice range must be [from, to] numbers")
    }
    if (to !== undefined && to < from) throw new OpError("splice range end precedes its start")
  }
  return true
}

/**
 * Apply one op to a mutable automerge draft (or a plain object, in tests).
 *
 * Must run inside `handle.change(...)` when the draft is a real automerge doc.
 * Returns a short human-readable description of what it did, which is what the
 * transcript shows as the call's one-line summary.
 */
export function applyOp(draft, op, { spliceText = null } = {}) {
  validateOp(op)
  const path = op.path ?? []
  const { range, value, find } = op

  // ---- FIND: anchor on text, compute the range here ----------------------
  //
  // The model has line numbers (fs_grep, fs_read) and the text itself; it does
  // not have character offsets, and asking it to produce them sent a real
  // session into a long loop of trying to count. So the anchor is the text.
  if (find !== undefined && find !== null) {
    const target = nodeAt(draft, path)
    if (typeof target !== "string") {
      throw new OpError(
        `cannot use \`find\` on /${path.join("/")}: it is ${target === undefined ? "missing" : typeof target}, not a string`
      )
    }
    const replacement = value == null ? "" : String(value)
    const at = locate(target, find)
    const { from, to, inserted } = minimalSplice(find, replacement)
    spliceString(draft, path, at + from, at + to, inserted, spliceText)
    return `replaced ${find.length} chars at line ${lineOf(target, at)} in /${path.join("/")}`
  }

  // ---- SPLICE: range is [from, to] -------------------------------------
  if (Array.isArray(range)) {
    const target = nodeAt(draft, path)
    const [from, to = from] = range

    if ((typeof target === "string" || Array.isArray(target)) && (from < 0 || to > target.length)) {
      const unit = typeof target === "string" ? "characters" : "items"
      throw new OpError(
        `range [${from}, ${to}] is outside /${path.join("/")}, which has ${target.length} ${unit}. [${target.length}, ${target.length}] appends.`
      )
    }

    if (typeof target === "string") {
      const inserted = value == null ? "" : String(value)
      spliceString(draft, path, from, to, inserted, spliceText)
      return `spliced ${inserted.length} chars at ${from} in /${path.join("/")}`
    }

    if (Array.isArray(target)) {
      const items = value == null ? [] : Array.isArray(value) ? value : [value]
      target.splice(from, Math.max(0, to - from), ...items)
      return `spliced ${items.length} item(s) at ${from} in /${path.join("/")}`
    }

    throw new OpError(
      `cannot splice /${path.join("/")}: it is ${target === undefined ? "missing" : typeof target}, not a string or list`
    )
  }

  // ---- ASSIGN / DELETE: range is a key ---------------------------------
  if (range !== undefined && range !== null) {
    const container = nodeAt(draft, path)
    if (container == null || typeof container !== "object") {
      throw new OpError(`cannot set a key on /${path.join("/")}: it is not a map or list`)
    }
    if (value === undefined || value === null) {
      // automerge cannot hold undefined; deleting is the way to remove a field
      if (Array.isArray(container)) {
        if (typeof range !== "number") throw new OpError("list keys must be numeric")
        container.splice(range, 1)
        return `removed index ${range} from /${path.join("/")}`
      }
      delete container[range]
      return `deleted ${range} from /${path.join("/")}`
    }
    if (Array.isArray(container)) {
      if (typeof range !== "number") throw new OpError("list keys must be numeric")
      if (range < 0 || range >= container.length) {
        throw new OpError(
          `index ${range} is outside /${path.join("/")}, which has ${container.length} item${container.length === 1 ? "" : "s"} (0–${container.length - 1}). To add an item, splice: { path: ${JSON.stringify(path)}, range: [${container.length}, ${container.length}], value: … }`
        )
      }
    }
    if (range in container) writeValue(draft, [...path, range], value, spliceText)
    else container[range] = value
    return `set ${range} on /${path.join("/")}`
  }

  // ---- ASSIGN the node at `path` itself ---------------------------------
  if (!path.length) throw new OpError("refusing to replace the document root; give a path or a range")
  if (value === undefined || value === null) {
    const { parent, key } = parentOf(draft, path)
    if (parent == null) throw new OpError(`cannot delete /${path.join("/")}: no parent`)
    if (Array.isArray(parent)) parent.splice(key, 1)
    else delete parent[key]
    return `deleted /${path.join("/")}`
  }
  const { parent, key } = parentOf(draft, path)
  if (parent == null || typeof parent !== "object") {
    throw new OpError(`cannot set /${path.join("/")}: its parent does not exist`)
  }
  if (Array.isArray(parent) && (typeof key !== "number" || key < 0 || key >= parent.length)) {
    throw new OpError(`index ${key} is outside /${path.slice(0, -1).join("/")}, which has ${parent.length} items. To add one, splice.`)
  }
  if (key in parent) writeValue(draft, path, value, spliceText)
  else parent[key] = value
  return `set /${path.join("/")}`
}

/** Apply a list of ops in order, collecting descriptions. Throws on the first bad op. */
export function applyOps(draft, ops, options) {
  const done = []
  for (const op of ops) done.push(applyOp(draft, op, options))
  return done
}
