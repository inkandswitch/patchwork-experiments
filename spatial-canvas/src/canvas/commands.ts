import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasShape, CanvasDoc } from "./types.js";

/**
 * Direct Automerge mutation helpers.
 * Each function calls handle.change() immediately — no undo history.
 */

export function createShape(handle: DocHandle<CanvasDoc>, shape: CanvasShape): void {
  const clean = JSON.parse(JSON.stringify(shape)) as CanvasShape;
  handle.change((doc) => {
    doc.shapes[clean.id] = clean;
  });
}

export function deleteShapes(handle: DocHandle<CanvasDoc>, ids: Iterable<string>): void {
  handle.change((doc) => {
    for (const id of ids) {
      delete doc.shapes[id];
    }
  });
}

export function translateShapes(
  handle: DocHandle<CanvasDoc>,
  moves: Map<string, { x: number; y: number }>,
): void {
  handle.change((doc) => {
    for (const [id, pos] of moves) {
      if (doc.shapes[id]) {
        doc.shapes[id].x = pos.x;
        doc.shapes[id].y = pos.y;
      }
    }
  });
}

export function patchShape(
  handle: DocHandle<CanvasDoc>,
  id: string,
  patch: Partial<Record<string, unknown>>,
): void {
  const clean = JSON.parse(JSON.stringify(patch)) as Partial<Record<string, unknown>>;
  handle.change((doc) => {
    if (doc.shapes[id]) {
      Object.assign(doc.shapes[id], clean);
    }
  });
}

/**
 * Duplicate the given shapes, offset by (dx, dy), and give them new ids at
 * the top of the z-stack.
 */
export function duplicateShapes(
  handle: DocHandle<CanvasDoc>,
  ids: Iterable<string>,
  dx: number,
  dy: number,
): string[] {
  // Snapshot plain values outside the change callback so we never hand
  // Automerge proxy objects back into the document.
  const snapshots: CanvasShape[] = [];
  const currentDoc = handle.doc();
  if (!currentDoc) return [];
  for (const id of ids) {
    const src = currentDoc.shapes[id];
    if (!src) continue;
    snapshots.push(JSON.parse(JSON.stringify(src)));
  }
  if (snapshots.length === 0) return [];

  const newIds = snapshots.map(() => newId());
  handle.change((doc) => {
    const base = nextZIndex(doc);
    snapshots.forEach((snap, i) => {
      const copy = { ...snap, id: newIds[i], x: snap.x + dx, y: snap.y + dy, zIndex: base + i };
      doc.shapes[copy.id] = copy;
    });
  });
  return newIds;
}

/** Generate a short random id for new shapes. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Return the next available zIndex (max + 1). */
export function nextZIndex(doc: CanvasDoc): number {
  const shapes = Object.values(doc.shapes);
  if (shapes.length === 0) return 0;
  return Math.max(...shapes.map((s) => s.zIndex)) + 1;
}
