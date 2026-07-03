// One-time localStorage key migration for the `newspace:` → `sketchy:` prefix
// rename (README Phase 2): new key absent + old present → copy
// across, delete the old. Best-effort — storage can throw (private mode,
// quota); a failed migrate must never break the canvas.
export function migrateStorageKey(oldKey, newKey, storage) {
  try {
    const s = storage || globalThis.localStorage;
    if (s.getItem(newKey) != null) return;
    const old = s.getItem(oldKey);
    if (old == null) return;
    s.setItem(newKey, old);
    s.removeItem(oldKey);
  } catch {}
}
