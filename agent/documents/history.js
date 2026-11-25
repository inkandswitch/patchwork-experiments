/**
 * What a change did, in words an agent can act on.
 *
 * Automerge will diff any two versions of a document into patches, but a patch
 * says where something went, not what was there before — and "what was there
 * before" is the whole point when someone has lost data. So each patch is
 * replayed against a copy of the earlier version, and every edit carries the
 * value it replaced or removed.
 *
 * The replay has to be patch by patch, not a lookup in the earlier version:
 * patches in one diff are relative to the ones before them. Delete item 0 of a
 * list and then item 0 again, and the second delete removed what used to be
 * item 1.
 */

/**
 * A copy of `root` that patches can be applied to, copying only the containers
 * on the paths they touch. `root` is typically a read-only automerge view of a
 * large document, and cloning all of it per change would be the expensive way
 * to learn that one key moved.
 */
function replica(root) {
  const owned = new WeakSet()
  const own = (value) => {
    const copy = Array.isArray(value) ? [...value] : { ...value }
    owned.add(copy)
    return copy
  }
  const top = { root: own(root) }

  /** The container at `path`, copied if this is the first write into it. */
  function container(path) {
    let node = top.root
    for (const key of path) {
      let child = node[key]
      if (child == null || typeof child !== "object") return child
      if (!owned.has(child)) {
        child = own(child)
        node[key] = child
      }
      node = child
    }
    return node
  }

  return { container }
}

/** Apply one patch to the replica and say what it did. Null for formatting-only patches we skip. */
function apply(rep, patch) {
  const path = patch.path
  const key = path.at(-1)
  const parentPath = path.slice(0, -1)

  switch (patch.action) {
    case "put": {
      const parent = rep.container(parentPath)
      const existed = parent != null && key in Object(parent)
      const was = existed ? parent[key] : undefined
      if (parent != null) parent[key] = patch.value
      return existed ? { op: "set", path, value: patch.value, was } : { op: "set", path, value: patch.value }
    }

    case "del": {
      const count = patch.length ?? 1
      const parent = rep.container(parentPath)
      if (typeof parent === "string") {
        // Text: the path ends in a character index, and the string lives one level up.
        const holder = rep.container(path.slice(0, -2))
        const was = parent.slice(key, key + count)
        holder[path.at(-2)] = parent.slice(0, key) + parent.slice(key + count)
        return { op: "delete", path, count, was }
      }
      if (Array.isArray(parent)) {
        const was = parent.splice(key, count)
        return { op: "delete", path, count, was: count === 1 ? was[0] : was }
      }
      const was = parent?.[key]
      if (parent != null) delete parent[key]
      return { op: "delete", path, was }
    }

    case "splice": {
      const text = rep.container(parentPath)
      if (typeof text === "string") {
        rep.container(path.slice(0, -2))[path.at(-2)] = text.slice(0, key) + patch.value + text.slice(key)
      }
      return { op: "insert", path, value: patch.value }
    }

    case "insert": {
      const list = rep.container(parentPath)
      if (Array.isArray(list)) list.splice(key, 0, ...patch.values)
      return { op: "insert", path, value: patch.values.length === 1 ? patch.values[0] : patch.values }
    }

    case "inc": {
      const parent = rep.container(parentPath)
      const was = parent?.[key]
      if (parent != null) parent[key] = Number(was ?? 0) + patch.value
      return { op: "increment", path, by: patch.value, was: Number(was ?? 0) }
    }

    case "mark":
    case "unmark":
      return { op: "format", path }

    default:
      return null // "conflict" says a value has rivals; the put that set it is already reported
  }
}

/**
 * Every edit between two versions of `doc`, each with the value it replaced.
 * Heads are automerge's hex change hashes; `[]` is the empty document.
 */
export function editsBetween(automerge, doc, fromHeads, toHeads) {
  return editsOfPatches(automerge.diff(doc, fromHeads, toHeads), automerge.view(doc, fromHeads))
}

/**
 * The edits a run of patches made to `before`, each with the value it replaced.
 * Patches are whole-document paths, in order, as a diff or a handle's change
 * event gives them; `before` is the document they apply to. Only the
 * containers they touch are copied, so a small change to a large document
 * costs only what it touched.
 */
export function editsOfPatches(patches, before) {
  const rep = replica(before)
  const edits = []
  // Assigning a string arrives as "new empty text here" and then "insert its
  // characters at 0". Said as one edit, it reads the way it was written. Only
  // text for a path that cannot have moved since is folded in: an insert or
  // delete in a list may shift indices, so it forgets every pending empty
  // string and the rest are left as they came — still true, just wordier.
  const emptyTexts = new Map() // path -> fill it in
  const at = (path) => JSON.stringify(path)

  for (const patch of patches) {
    const edit = apply(rep, patch)
    if (!edit) continue

    if (edit.op === "insert" && typeof edit.value === "string" && edit.path.at(-1) === 0) {
      const fill = emptyTexts.get(at(edit.path.slice(0, -1)))
      if (fill) {
        fill(edit.value)
        emptyTexts.delete(at(edit.path.slice(0, -1)))
        continue
      }
    }
    if (patch.action === "insert" || patch.action === "del") emptyTexts.clear()
    edits.push(edit)

    if (edit.op === "set" && edit.value === "") {
      emptyTexts.set(at(edit.path), (text) => { edit.value = text })
    } else if (edit.op === "insert" && Array.isArray(patch.values)) {
      const list = edit.path.slice(0, -1)
      const first = edit.path.at(-1)
      patch.values.forEach((value, i) => {
        if (value !== "") return
        emptyTexts.set(at([...list, first + i]), (text) => {
          if (Array.isArray(edit.value)) edit.value[i] = text
          else edit.value = text
        })
      })
    }
  }
  return edits
}

/** One change's edits: the difference between its parents and itself. */
export function editsOfChange(automerge, doc, meta) {
  return editsBetween(automerge, doc, meta.deps, [meta.hash])
}

/** Searchable text for a value, which may be an automerge proxy. */
export function textOf(value) {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

/**
 * Does this edit write or remove something matching `pattern`? Null if not;
 * otherwise the snippet around the match, or "" when the value is short enough
 * that the edit already shows it whole.
 */
export function matchEdit(edit, pattern, { shown = 200 } = {}) {
  for (const field of ["was", "value"]) {
    const text = textOf(edit[field])
    const found = pattern.exec(text)
    if (!found) continue
    if (text.length <= shown) return ""
    const start = Math.max(0, found.index - 60)
    const end = Math.min(text.length, found.index + found[0].length + 60)
    return `${field}: ${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
  }
  return null
}

/** Does `edit` touch `path` — at it, under it, or by replacing something above it? */
export function touchesPath(edit, path) {
  const shorter = Math.min(edit.path.length, path.length)
  for (let i = 0; i < shorter; i++) {
    if (String(edit.path[i]) !== String(path[i])) return false
  }
  return true
}

/**
 * The document as it stood at a moment: the newest changes stamped at or before
 * `when`. Times are the writer's own clock, in seconds, and a writer may leave
 * them out (0); such a change counts only if a timed one was built on it.
 */
export function headsAt(automerge, doc, when) {
  const t = when.getTime() / 1000
  const kept = automerge
    .getAllChanges(doc)
    .map((change) => automerge.decodeChange(change))
    .filter((meta) => meta.time && meta.time <= t)
  const parents = new Set(kept.flatMap((meta) => meta.deps))
  return kept.filter((meta) => !parents.has(meta.hash)).map((meta) => meta.hash)
}
