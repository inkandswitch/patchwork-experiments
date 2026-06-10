// Vendored from @automerge/automerge-repo-solid-primitives@2.6.0-subduction.29
// (https://github.com/automerge/automerge-repo, packages/automerge-repo-solid-primitives).
//
// Vendored to fix a bug in document projections: they applied patches with
// @automerge/automerge's `applyPatches`, which cannot apply a `del` patch
// whose target is a map key (it assumes deletions only happen in arrays or
// text and throws `RangeError: index is not a number for patch`). Deleting
// map keys is routine here — removing a shape from a layer, clearing a
// selection entry — and every live projection of the doc blew up on it.
// See ./applyPatches.ts for the fix; autoproduce.ts and
// makeDocumentProjection.ts route through it. Everything else is unchanged.
export { default as autoproduce } from "./autoproduce.js"
export { default as useDocument } from "./useDocument.js"
export { default as useDocHandle } from "./useDocHandle.js"
export { default as makeDocumentProjection } from "./makeDocumentProjection.js"
export { default as createDocumentProjection } from "./createDocumentProjection.js"
export { default as makeDocSignal } from "./makeDocSignal.js"
export { default as createDocSignal } from "./createDocSignal.js"
export { default as useDocSignal } from "./useDocSignal.js"
export { default as useRepo } from "./useRepo.js"
export { RepoContext } from "./context.js"
