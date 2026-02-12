import type { TLStoreSnapshot } from "tldraw"
import { createDefaultStoreSnapshot } from "./default_store"

/* a similar pattern to other automerge init functions */
export function init(doc: TLStoreSnapshot) {
  Object.assign(doc, createDefaultStoreSnapshot())
}

export * from "./useAutomergeStore"
