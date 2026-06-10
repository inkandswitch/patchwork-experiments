// The reason this package is vendored.
//
// @automerge/automerge's `applyPatches` (the patch applier document
// projections use to keep their snapshot in sync) cannot apply a `del` patch
// whose target is a map key: its `applyDelPatch` requires the final path
// element to be a numeric index into an array or text and throws
// `RangeError: index is not a number for patch` otherwise. Deleting a map key
// is an entirely ordinary Automerge change (e.g. `delete doc.shapes[id]`), so
// every projection of a doc that had a key removed crashed in its change
// listener.
//
// This wrapper applies map-key deletions itself and delegates everything else
// to the upstream implementation.

// @ts-ignore — provided at runtime by the host's import map (it is in the
// bootloader's externals); there is no local install for tsc to resolve.
import { applyPatches as upstreamApplyPatches } from "@automerge/automerge/slim"

export type Patch = {
  action: string
  path: (string | number)[]
}

export function applyPatches<T>(doc: T, patches: Patch[]): void {
  for (const patch of patches) {
    const key = patch.path.at(-1)
    if (patch.action === "del" && typeof key === "string") {
      const parent = resolveParent(doc, patch.path)
      // A string key can only address a map. Anything else (vanished parent,
      // array/text) is left to upstream so behavior there is unchanged.
      if (
        parent !== null &&
        typeof parent === "object" &&
        !Array.isArray(parent)
      ) {
        delete (parent as Record<string, unknown>)[key]
        continue
      }
    }
    upstreamApplyPatches(doc, [patch])
  }
}

function resolveParent(doc: unknown, path: (string | number)[]): unknown {
  let parent = doc
  for (const segment of path.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return undefined
    parent = (parent as Record<string | number, unknown>)[segment]
  }
  return parent
}
