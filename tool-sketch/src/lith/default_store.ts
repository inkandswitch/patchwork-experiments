import {
  createTLStore,
  defaultShapeUtils,
  type TLStoreSnapshot,
  type TLPageId,
} from "tldraw";

let cachedSnapshot: TLStoreSnapshot | null = null;

/**
 * Creates a default store snapshot using tldraw's createTLStore and
 * ensureStoreIsUsable. This keeps the default structure in sync with
 * tldraw's current schema and record versions.
 */
export function createDefaultStoreSnapshot(): TLStoreSnapshot {
  if (cachedSnapshot) return cachedSnapshot;

  const store = createTLStore({
    shapeUtils: [...defaultShapeUtils],
  });
  // ensureStoreIsUsable is @internal but populates the store with default records
  (store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable();

  const snapshot = store.getStoreSnapshot("all") as TLStoreSnapshot;

  // Override the default page name to match our datatype's convention
  const pageKey = "page:page" as TLPageId;
  const page = snapshot.store[pageKey];
  if (page) {
    snapshot.store = {
      ...snapshot.store,
      [pageKey]: { ...page, name: "My drawing" },
    };
  }

  cachedSnapshot = snapshot;
  return snapshot;
}
