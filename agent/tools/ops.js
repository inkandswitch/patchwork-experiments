/**
 * One vocabulary for every edit to any automerge document.
 *
 *   path   (string|number)[]   keys/indices from the doc root to the thing you
 *                              are touching. [] is the root.
 *   range  [from, to] | key    an array => SPLICE: replace elements from..to
 *                              (characters if the target is a string, items if
 *                              it is a list). A key => ASSIGN that key, or
 *                              DELETE it when no value is supplied.
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

export function validateOp(op) {
  if (!op || typeof op !== "object") throw new OpError("op must be an object")
  const path = op.path ?? []
  if (!Array.isArray(path)) throw new OpError("path must be an array")
  for (const key of path) {
    if (typeof key !== "string" && typeof key !== "number") {
      throw new OpError(`path segments must be strings or numbers, got ${typeof key}`)
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
  const { range, value } = op

  // ---- SPLICE: range is [from, to] -------------------------------------
  if (Array.isArray(range)) {
    const target = nodeAt(draft, path)
    const [from, to = from] = range

    if (typeof target === "string") {
      const inserted = value == null ? "" : String(value)
      if (spliceText) {
        spliceText(draft, path, from, Math.max(0, to - from), inserted)
      } else {
        const { parent, key } = parentOf(draft, path)
        if (!parent) throw new OpError("cannot splice the document root as text")
        parent[key] = target.slice(0, from) + inserted + target.slice(to)
      }
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
    container[range] = value
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
  parent[key] = value
  return `set /${path.join("/")}`
}

/** Apply a list of ops in order, collecting descriptions. Throws on the first bad op. */
export function applyOps(draft, ops, options) {
  const done = []
  for (const op of ops) done.push(applyOp(draft, op, options))
  return done
}
