import type { next as A } from "@automerge/automerge/slim";

export {
  LayeredDoc,
  createPatch,
  fromAutomergePatches,
  isEntryStale,
  isMarkPatch,
  isPatchStale,
  isPathPatch,
  isRunPatch,
  isTextPatch,
  landPatch,
  markPatch,
  patchHighlights,
  readEntry,
  textPatch,
  type EntryReading,
  type Layer,
  type MarkPatch,
  type OpsError,
  type PatchDoc,
  type PatchEntry,
  type PatchHighlight,
  type PathPatch,
  type RunPatch,
  type TextPatch,
} from "./patch-layers.js";
export {
  providePatchLayers,
  type Descriptor,
  type PatchProviderOptions,
} from "./provider.js";
export { realmScratchRepo } from "./scratch.js";

/** The Automerge patches `fromAutomergePatches` reads. */
export type AutomergeOp = A.Patch;
/** What an Automerge `put` patch puts. */
export type PutValue = Extract<A.Patch, { action: "put" }>["value"];
