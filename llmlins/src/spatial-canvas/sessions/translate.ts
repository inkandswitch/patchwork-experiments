import type { Session, PointerInfo, CanvasShape, CanvasDoc, DocHandle } from '../types.js'

/**
 * TranslateSession — drag to move selected shapes.
 * Accumulates delta in memory; commits to Automerge on complete().
 * On cancel(), restores shapes to their original positions.
 */
export function createTranslateSession(
  selectedIds: Set<string>,
  doc: CanvasDoc,
  handle: DocHandle<CanvasDoc>,
  /** Called on every update so the UI can preview movement. */
  onPreview: (deltas: Map<string, { x: number; y: number }>) => void
): Session {
  // Snapshot original positions
  const originals = new Map<string, { x: number; y: number }>()
  for (const id of selectedIds) {
    const shape = doc.shapes[id]
    if (shape) originals.set(id, { x: shape.x, y: shape.y })
  }

  let totalDx = 0
  let totalDy = 0

  return {
    update(info: PointerInfo) {
      totalDx += info.dx
      totalDy += info.dy

      const deltas = new Map<string, { x: number; y: number }>()
      for (const [id, orig] of originals) {
        deltas.set(id, { x: orig.x + totalDx, y: orig.y + totalDy })
      }
      onPreview(deltas)
    },

    complete(_info: PointerInfo) {
      if (totalDx === 0 && totalDy === 0) return
      handle.change(d => {
        for (const [id, orig] of originals) {
          if (d.shapes[id]) {
            d.shapes[id].x = orig.x + totalDx
            d.shapes[id].y = orig.y + totalDy
          }
        }
      })
    },

    cancel() {
      // Preview was in-memory only — just re-render with originals
      const deltas = new Map<string, { x: number; y: number }>()
      for (const [id, orig] of originals) {
        deltas.set(id, orig)
      }
      onPreview(deltas)
    },
  }
}
