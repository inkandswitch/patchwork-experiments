// Vendor change: import the fullfat entrypoint (upstream used "/slim") — the
// slim d.ts re-exports through "@automerge/automerge/slim", which has no local
// install to resolve types from, and the rest of this package uses fullfat.
import type { DocHandleChangePayload } from "@automerge/automerge-repo"
// Vendor fix: route through the local applier that handles map-key deletes
// (upstream imported applyPatches from "@automerge/automerge/slim").
import { applyPatches, type Patch } from "./applyPatches.js"

/**
 * convert automerge patches to solid producer operations
 * @param payload the
 * [DocHandleChangePayload](https://automerge.org/automerge-repo/interfaces/_automerge_automerge_repo.DocHandleChangePayload.html)
 * from the handle.on("change
 * @returns a callback for an immer-like function. e.g.
 * [produce](https://docs.solidjs.com/reference/store-utilities/produce) for
 * [Solid
 * Stores](https://docs.solidjs.com/reference/store-utilities/create-store)
 */
export default function autoproduce<T>(
  payload: DocHandleChangePayload<T>
): (doc: T) => void {
  return (doc: T) => applyPatches(doc, payload.patches as Patch[])
}
