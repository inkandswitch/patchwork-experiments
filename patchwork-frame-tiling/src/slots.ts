import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolSlot } from "./types";

/**
 * The id that identifies a slot regardless of its kind (tool tuple or bare
 * component string). Mirrors threepane's `slotId` helper so both frames agree
 * on how to read the shared config doc's `ToolSlot` entries. Discriminate by
 * `Array.isArray`, not `typeof slot === "string"`: Automerge can return a
 * raw-string slot as a `RawString` object rather than a native string, and
 * `typeof` would then misfire to the tuple branch and index `slot[0]` —
 * yielding the id's first character instead of the whole id.
 */
export const slotId = (slot: ToolSlot): string =>
  Array.isArray(slot) ? String(slot[0]) : String(slot);

/** The document a tool-tuple slot renders against, or undefined for a bare component. */
export const slotDocUrl = (slot: ToolSlot): AutomergeUrl | undefined =>
  Array.isArray(slot) ? (slot[1] as AutomergeUrl) : undefined;
