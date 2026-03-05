import type { Session, PointerInfo, CanvasShape, CanvasDoc, DocHandle } from '../types.js'

export type HandleEdge = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw'

const MIN_SIZE = 16

/**
 * ResizeSession — drag a corner or edge handle to resize a shape.
 * Commits to Automerge on complete().
 */
export function createResizeSession(
  shapeId: string,
  edge: HandleEdge,
  doc: CanvasDoc,
  handle: DocHandle<CanvasDoc>,
  onPreview: (shapeId: string, next: Partial<CanvasShape>) => void
): Session {
  const original = doc.shapes[shapeId]
  if (!original) {
    return { update() {}, complete() {}, cancel() {} }
  }

  const orig = { x: original.x, y: original.y, width: original.width, height: original.height }
  let preview = { ...orig }

  return {
    update(info: PointerInfo) {
      let { x, y, width, height } = orig
      const dx = info.x - info.origin.x
      const dy = info.y - info.origin.y

      if (edge.includes('e')) width  = Math.max(MIN_SIZE, orig.width  + dx)
      if (edge.includes('s')) height = Math.max(MIN_SIZE, orig.height + dy)
      if (edge.includes('w')) {
        const dw = Math.min(orig.width - MIN_SIZE, dx)
        x = orig.x + dw
        width = orig.width - dw
      }
      if (edge.includes('n')) {
        const dh = Math.min(orig.height - MIN_SIZE, dy)
        y = orig.y + dh
        height = orig.height - dh
      }

      preview = { x, y, width, height }
      onPreview(shapeId, preview)
    },

    complete(_info: PointerInfo) {
      if (
        preview.x === orig.x &&
        preview.y === orig.y &&
        preview.width === orig.width &&
        preview.height === orig.height
      ) return

      handle.change(d => {
        if (d.shapes[shapeId]) {
          d.shapes[shapeId].x = preview.x
          d.shapes[shapeId].y = preview.y
          d.shapes[shapeId].width = preview.width
          d.shapes[shapeId].height = preview.height
        }
      })
    },

    cancel() {
      onPreview(shapeId, orig)
    },
  }
}
