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
    tldrawMap[record.id] = tldrawValueToAutomergeValue(record);
  }

  for (const record of changes.updated) {
    if (!tldrawMap[record.id]) {
      tldrawMap[record.id] = tldrawValueToAutomergeValue(record);
      continue;
    }
    deepCompareAndUpdate(tldrawMap[record.id], record);
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

export function tldrawValueToAutomergeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(tldrawValueToAutomergeValue);
  }
  if (value != null && typeof value === 'object') {
    const obj: any = {};
    for (const key in value) {
      obj[key] = tldrawValueToAutomergeValue(value[key]);
    }
    return obj;
  }
  return value;
}

function deepCompareAndUpdate(objectA: any, objectB: any) {
  if (Array.isArray(objectB)) {
    if (!Array.isArray(objectA)) {
      // if objectA is not an array, replace it with objectB
      objectA = objectB.map(tldrawValueToAutomergeValue);
    } else {
      // compare and update array elements
      for (let i = 0; i < objectB.length; i++) {
        if (i >= objectA.length) {
          objectA.push(tldrawValueToAutomergeValue(objectB[i]));
        } else {
          if ((objectB[i] != null && typeof objectB[i] === 'object') || Array.isArray(objectB[i])) {
            // if element is an object or array, recursively compare and update
            deepCompareAndUpdate(objectA[i], objectB[i]);
          } else if (objectA[i] !== objectB[i]) {
            // update the element
            objectA[i] = tldrawValueToAutomergeValue(objectB[i]);
          }
        }
      }
      // remove extra elements
      if (objectA.length > objectB.length) {
        objectA.splice(objectB.length);
      }
    }
  } else if (objectB != null && typeof objectB === 'object') {
    for (const key in objectB) {
      const value = objectB[key];
      if (objectA[key] === undefined) {
        // if key is not in objectA, add it
        objectA[key] = tldrawValueToAutomergeValue(value);
      } else {
        if ((value != null && typeof value === 'object') || Array.isArray(value)) {
          // if value is an object or array, recursively compare and update
          deepCompareAndUpdate(objectA[key], value);
        } else if (objectA[key] !== value) {
          // update the value
          objectA[key] = tldrawValueToAutomergeValue(value);
        }
      }
    }

    // remove extra keys
    for (const key in objectA) {
      if ((objectB as any)[key] === undefined) {
        // if key is not in objectB, remove it
        delete objectA[key];
      }
    }
  }
}
