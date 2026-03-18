/**
 * Fixed version of @automerge/automerge's apply_patches.js.
 *
 * The upstream applyDelPatch only handles list and text (string) deletions.
 * It throws "index is not a number for patch" when deleting a map key, because
 * map key props are strings (e.g. UUID), not numbers.
 *
 * The fix adds an object branch that calls `delete parent[prop]` for map key
 * deletions before falling through to the error.
 */
import { isAutomerge, isCounter, mark, splice, unmark } from "@automerge/automerge/slim"
import type { Doc, Patch, Prop } from "@automerge/automerge/slim"

type ResolvedPathElem = {
  obj: unknown
  prop: Prop
  parentPath: Prop[]
}

type ResolvedPath = ResolvedPathElem[]

export function applyPatch(doc: unknown, patch: Patch): void {
  const path = resolvePath(doc, patch.path)
  if (patch.action === "put") {
    applyPutPatch(path, patch)
  } else if (patch.action === "insert") {
    applyInsertPatch(path, patch)
  } else if (patch.action === "del") {
    applyDelPatch(doc, path, patch)
  } else if (patch.action === "splice") {
    applySplicePatch(doc, path, patch)
  } else if (patch.action === "inc") {
    applyIncPatch(doc, path, patch)
  } else if (patch.action === "mark") {
    applyMarkPatch(doc, path, patch)
  } else if (patch.action === "unmark") {
    applyUnmarkPatch(doc, path, patch)
  } else if ((patch as Patch).action === "conflict") {
    // Ignore conflict patches
  } else {
    throw new RangeError(`unsupported patch: ${JSON.stringify(patch)}`)
  }
}

function applyPutPatch(path: ResolvedPath, patch: Extract<Patch, { action: "put" }>): void {
  const { obj: parent, prop } = pathElemAt(path, -1)
  ;(parent as Record<Prop, unknown>)[prop] = patch.value
}

function applyInsertPatch(path: ResolvedPath, patch: Extract<Patch, { action: "insert" }>): void {
  const { obj: parent, prop } = pathElemAt(path, -1)
  if (!Array.isArray(parent)) {
    throw new RangeError(`target is not an array for patch`)
  }
  if (typeof prop !== "number") {
    throw new RangeError(`index is not a number for patch`)
  }
  parent.splice(prop, 0, ...patch.values)
}

function applyDelPatch(doc: unknown, path: ResolvedPath, patch: Extract<Patch, { action: "del" }>): void {
  const { obj: parent, prop, parentPath } = pathElemAt(path, -1)
  if (Array.isArray(parent)) {
    if (typeof prop !== "number") {
      throw new RangeError(`index is not a number for patch`)
    }
    parent.splice(prop, patch.length || 1)
  } else if (typeof parent === "string") {
    if (isAutomerge(doc)) {
      if (typeof prop !== "number") {
        throw new RangeError(`index is not a number for patch`)
      }
      splice(doc as Doc<unknown>, parentPath, prop, patch.length || 1)
    } else {
      const { obj: grandParent, prop: grandParentProp } = pathElemAt(path, -2)
      if (typeof prop !== "number") {
        throw new RangeError(`index is not a number for patch`)
      }
      const target = (grandParent as Record<Prop, unknown>)[grandParentProp]
      if (target == null || typeof target !== "string") {
        throw new RangeError(`target is not a string for patch`)
      }
      const newString = target.slice(0, prop) + target.slice(prop + (patch.length || 1))
      ;(grandParent as Record<Prop, unknown>)[grandParentProp] = newString
    }
  } else if (typeof parent === "object" && parent !== null) {
    // Map key deletion: prop is a string key (e.g. a UUID)
    delete (parent as Record<string, unknown>)[prop as string]
  } else {
    throw new RangeError(`target is not an array or string for patch`)
  }
}

function applySplicePatch(doc: unknown, path: ResolvedPath, patch: Extract<Patch, { action: "splice" }>): void {
  if (isAutomerge(doc)) {
    const { obj: parent, prop, parentPath } = pathElemAt(path, -1)
    if (typeof prop !== "number") {
      throw new RangeError(`index is not a number for patch`)
    }
    splice(doc as Doc<unknown>, parentPath, prop, 0, patch.value)
  } else {
    const { prop } = pathElemAt(path, -1)
    const { obj: grandParent, prop: grandParentProp } = pathElemAt(path, -2)
    if (typeof prop !== "number") {
      throw new RangeError(`index is not a number for patch`)
    }
    const target = (grandParent as Record<Prop, unknown>)[grandParentProp]
    if (target == null || typeof target !== "string") {
      throw new RangeError(`target is not a string for patch`)
    }
    const newString = target.slice(0, prop) + patch.value + target.slice(prop)
    ;(grandParent as Record<Prop, unknown>)[grandParentProp] = newString
  }
}

function applyIncPatch(doc: unknown, path: ResolvedPath, patch: Extract<Patch, { action: "inc" }>): void {
  const { obj: parent, prop } = pathElemAt(path, -1)
  const counter = (parent as Record<Prop, unknown>)[prop]
  if (isAutomerge(doc)) {
    if (!isCounter(counter)) {
      throw new RangeError(`target is not a counter for patch`)
    }
    counter.increment(patch.value)
  } else {
    if (typeof counter !== "number") {
      throw new RangeError(`target is not a number for patch`)
    }
    ;(parent as Record<Prop, unknown>)[prop] = counter + patch.value
  }
}

function applyMarkPatch(doc: unknown, path: ResolvedPath, patch: Extract<Patch, { action: "mark" }>): void {
  const { obj: parent, prop } = pathElemAt(path, -1)
  if (!isAutomerge(doc)) return
  for (const markSpec of patch.marks) {
    mark(
      doc as Doc<unknown>,
      patch.path,
      { start: markSpec.start, end: markSpec.end, expand: "none" },
      markSpec.name,
      markSpec.value,
    )
  }
}

function applyUnmarkPatch(doc: unknown, _path: ResolvedPath, patch: Extract<Patch, { action: "unmark" }>): void {
  if (!isAutomerge(doc)) return
  unmark(doc as Doc<unknown>, patch.path, { start: patch.start, end: patch.end, expand: "none" }, patch.name)
}

export function applyPatches(doc: unknown, patches: Patch[]): void {
  for (const patch of patches) {
    applyPatch(doc, patch)
  }
}

function resolvePath(doc: unknown, path: Prop[]): ResolvedPath {
  const result: ResolvedPath = []
  let current: unknown = doc
  const currentPath: Prop[] = []
  for (const [index, prop] of path.entries()) {
    result.push({ obj: current, prop, parentPath: currentPath.slice() })
    currentPath.push(prop)
    if (index !== path.length - 1) {
      if (current == null || typeof current !== "object") {
        throw new Error(`Invalid path: ${path}`)
      }
      current = (current as Record<Prop, unknown>)[prop]
    } else {
      break
    }
  }
  return result
}

function pathElemAt(resolved: ResolvedPath, index: number): ResolvedPathElem {
  const result = resolved.at(index)
  if (result == undefined) {
    throw new Error("invalid path")
  }
  return result
}
