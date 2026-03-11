import type { CanvasShape, CanvasDoc, DocHandle } from './types.js'

/**
 * Direct Automerge mutation helpers.
 * Each function calls handle.change() immediately — no undo history.
 */

export function createShape(
  handle: DocHandle<CanvasDoc>,
  shape: CanvasShape
): void {
  handle.change(doc => {
    doc.shapes[shape.id] = shape
  })
}

export function deleteShapes(
  handle: DocHandle<CanvasDoc>,
  ids: Iterable<string>
): void {
  handle.change(doc => {
    for (const id of ids) {
      delete doc.shapes[id]
    }
  })
}

export function translateShapes(
  handle: DocHandle<CanvasDoc>,
  moves: Map<string, { x: number; y: number }>
): void {
  handle.change(doc => {
    for (const [id, pos] of moves) {
      if (doc.shapes[id]) {
        doc.shapes[id].x = pos.x
        doc.shapes[id].y = pos.y
      }
    }
  })
}

export function patchShape(
  handle: DocHandle<CanvasDoc>,
  id: string,
  patch: Partial<Record<string, unknown>>
): void {
  handle.change(doc => {
    if (doc.shapes[id]) {
      Object.assign(doc.shapes[id], patch)
    }
  })
}

/** Generate a short random id for new shapes. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Return the next available zIndex (max + 1). */
export function nextZIndex(doc: CanvasDoc): number {
  const shapes = Object.values(doc.shapes)
  if (shapes.length === 0) return 0
  return Math.max(...shapes.map(s => s.zIndex)) + 1
}
