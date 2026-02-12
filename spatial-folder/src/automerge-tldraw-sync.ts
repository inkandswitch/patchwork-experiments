/**
 * Bidirectional sync helpers for tldraw ↔ automerge.
 *
 * Records are stored as plain objects (not JSON strings) under
 * `doc.tldraw[recordId]`, so automerge can produce granular patches.
 *
 * Based on https://github.com/pvh/automerge-tldraw
 */

import type { TLRecord, TLStore } from 'tldraw';
import type { Patch } from '@automerge/automerge';

// ============================================================================
// tldraw → automerge
// ============================================================================

/**
 * Write tldraw store changes into the automerge doc's `tldraw` map.
 *
 * - Added records are assigned directly.
 * - Updated records are deep-compared so only changed leaves create
 *   automerge operations (minimises patch traffic).
 * - Removed records are deleted from the map.
 */
export function applyTLStoreChangesToAutomergeDoc(
  tldrawMap: Record<string, any>,
  changes: {
    added: TLRecord[];
    updated: TLRecord[];
    removed: TLRecord[];
  },
) {
  for (const record of changes.added) {
    tldrawMap[record.id] = structuredCloneCompat(record);
  }

  for (const record of changes.updated) {
    const existing = tldrawMap[record.id];
    if (existing === undefined || typeof existing === 'string') {
      // Missing, or old JSON-string format — replace the whole thing.
      tldrawMap[record.id] = structuredCloneCompat(record);
    } else {
      deepCompareAndUpdate(existing, record);
    }
  }

  for (const record of changes.removed) {
    delete tldrawMap[record.id];
  }
}

// ============================================================================
// automerge → tldraw
// ============================================================================

/**
 * Apply automerge patches (from a `handle.on('change')` event) to a
 * tldraw `TLStore`.  Only patches whose root path component is
 * `"tldraw"` are processed.
 */
export function applyAutomergePatchesToTLStore(
  patches: Patch[],
  store: TLStore,
  currentPageId: string,
) {
  const toRemove: TLRecord['id'][] = [];
  const updatedObjects: Record<string, TLRecord> = {};

  for (const patch of patches) {
    if (!isTldrawPatch(patch)) continue;

    const id = pathToRecordId(patch.path);

    switch (patch.action) {
      case 'del': {
        if (patch.path.length === 2) {
          // Deleting the whole record
          toRemove.push(id as TLRecord['id']);
        } else {
          // Deleting a property inside a record
          const record = updatedObjects[id] ?? cloneFromStore(store, id);
          if (record) {
            applyDelToObject(patch, record);
            updatedObjects[id] = record;
          }
        }
        break;
      }
      case 'put': {
        if (patch.path.length === 2) {
          // Whole record being set — typically an add
          if (patch.value && typeof patch.value === 'object') {
            updatedObjects[id] = remapParentPage(patch.value as TLRecord, currentPageId);
          }
        } else {
          const record = updatedObjects[id] ?? cloneFromStore(store, id);
          if (record) {
            updatedObjects[id] = applyPutToObject(patch, record);
          }
        }
        break;
      }
      case 'insert': {
        const record = updatedObjects[id] ?? cloneFromStore(store, id);
        if (record) {
          updatedObjects[id] = applyInsertToObject(patch, record);
        }
        break;
      }
      case 'splice': {
        const record = updatedObjects[id] ?? cloneFromStore(store, id);
        if (record) {
          updatedObjects[id] = applySpliceToObject(patch, record);
        }
        break;
      }
      case 'inc':
      case 'mark':
      case 'unmark':
      case 'conflict':
        // Not relevant for tldraw records.
        break;
      default:
        console.warn('[spatial-folder] unsupported patch action:', (patch as any).action);
        break;
    }
  }

  const toPut = Object.values(updatedObjects).map((r) => remapParentPage(r, currentPageId));

  if (toPut.length === 0 && toRemove.length === 0) return;

  store.mergeRemoteChanges(() => {
    if (toRemove.length) store.remove(toRemove);
    if (toPut.length) store.put(toPut);
  });
}

// ============================================================================
// Helpers — patch application
// ============================================================================

function isTldrawPatch(patch: Patch): boolean {
  return patch.path[0] === 'tldraw' && patch.path.length >= 2;
}

/** `["tldraw", "shape:abc123", "x"]` → `"shape:abc123"` */
function pathToRecordId(path: (string | number)[]): string {
  return String(path[1]);
}

function cloneFromStore(store: TLStore, id: string): TLRecord | null {
  const existing = store.get(id as TLRecord['id']);
  if (!existing) return null;
  return JSON.parse(JSON.stringify(existing));
}

function applyPutToObject(patch: Patch, object: any): TLRecord {
  const { path, value } = patch as any;
  if (path.length === 3) {
    // e.g. ["tldraw", "shape:X", "x"] → set object.x
    const prop = path[2];
    object[prop] = value;
    return object;
  }

  // Deeper path: walk to the parent and set the leaf.
  let current = object;
  const parts = path.slice(2, -1);
  for (const part of parts) {
    if (current[part] === undefined) return object;
    current = current[part];
  }
  const leaf = path[path.length - 1];
  current[leaf] = value;
  return object;
}

function applyDelToObject(patch: Patch, object: any): TLRecord {
  const { path } = patch;
  if (path.length === 3) {
    delete object[path[2]];
    return object;
  }
  let current = object;
  const parts = path.slice(2, -1);
  for (const part of parts) {
    if (current[part] === undefined) return object;
    current = current[part];
  }
  delete current[path[path.length - 1]];
  return object;
}

function applyInsertToObject(patch: Patch, object: any): TLRecord {
  const { path, values } = patch as any;
  let current = object;
  const insertionPoint = path[path.length - 1] as number;
  const arrayKey = path[path.length - 2];
  const parts = path.slice(2, -2);
  for (const part of parts) {
    if (current[part] === undefined) return object;
    current = current[part];
  }
  const clone = (current[arrayKey] as any[]).slice(0);
  clone.splice(insertionPoint, 0, ...(values as any[]));
  current[arrayKey] = clone;
  return object;
}

function applySpliceToObject(patch: Patch, object: any): TLRecord {
  const { path, value } = patch as any;
  let current = object;
  const insertionPoint = path[path.length - 1] as number;
  const arrayKey = path[path.length - 2];
  const parts = path.slice(2, -2);
  for (const part of parts) {
    if (current[part] === undefined) return object;
    current = current[part];
  }
  if (insertionPoint !== 0) {
    // tldraw doesn't generate mid-array splices natively.
    console.warn('[spatial-folder] mid-array splice not fully supported');
  }
  current[arrayKey] = value;
  return object;
}

// ============================================================================
// Helpers — deep compare & update (tldraw → automerge)
// ============================================================================

/**
 * Recursively walk `objectA` (the automerge proxy) and `objectB` (the new
 * tldraw record) and only assign leaves that actually changed.  This is
 * critical so automerge generates fine-grained operations instead of
 * replacing the entire record.
 */
function deepCompareAndUpdate(objectA: any, objectB: any): void {
  if (Array.isArray(objectB)) {
    if (!Array.isArray(objectA)) {
      // Type mismatch — overwrite.
      Object.assign(objectA, objectB);
      return;
    }
    for (let i = 0; i < objectB.length; i++) {
      if (i >= objectA.length) {
        objectA.push(objectB[i]);
      } else if (isObject(objectB[i]) || Array.isArray(objectB[i])) {
        deepCompareAndUpdate(objectA[i], objectB[i]);
      } else if (objectA[i] !== objectB[i]) {
        objectA[i] = objectB[i];
      }
    }
    // Trim excess elements.
    while (objectA.length > objectB.length) {
      objectA.pop();
    }
  } else if (isObject(objectB)) {
    // Set new / changed keys.
    for (const key of Object.keys(objectB)) {
      if (objectA[key] === undefined) {
        objectA[key] = objectB[key];
      } else if (isObject(objectB[key]) || Array.isArray(objectB[key])) {
        deepCompareAndUpdate(objectA[key], objectB[key]);
      } else if (objectA[key] !== objectB[key]) {
        objectA[key] = objectB[key];
      }
    }
    // Remove keys that no longer exist.
    for (const key of Object.keys(objectA)) {
      if ((objectB as any)[key] === undefined) {
        delete objectA[key];
      }
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ============================================================================
// Helpers — page remapping
// ============================================================================

/**
 * Tldraw generates a fresh page id on every mount.  Stored shapes
 * reference the old page id as their `parentId`.  Rewrite it so
 * shapes land on the current page.
 */
function remapParentPage(record: TLRecord, currentPageId: string): TLRecord {
  const r = record as any;
  if (
    r.typeName === 'shape' &&
    typeof r.parentId === 'string' &&
    r.parentId.startsWith('page:') &&
    r.parentId !== currentPageId
  ) {
    return { ...r, parentId: currentPageId };
  }
  return record;
}

// ============================================================================
// Helpers — compat
// ============================================================================

/**
 * Read a stored record that might be either a plain object (new format) or
 * a JSON string (old format). Returns the record object either way.
 */
export function readStoredRecord(value: unknown): TLRecord | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as TLRecord;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as TLRecord;
  return null;
}

function structuredCloneCompat<T>(obj: T): T {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}
