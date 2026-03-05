import type { Session, PointerInfo, CanvasDoc, Rect } from '../types.js'
import { rectsIntersect, shapeBounds } from '../math/rect.js'

/**
 * BrushSession — drag to marquee-select shapes.
 * Updates selectedIds live during drag; on complete() returns the final set.
 * Ephemeral — nothing is written to Automerge.
 */
export function createBrushSession(
  origin: { x: number; y: number },
  doc: CanvasDoc,
  brushEl: HTMLElement,
  onSelectionChange: (ids: Set<string>) => void
): Session {
  let current = { x: origin.x, y: origin.y, width: 0, height: 0 }

  function getBrushRect(info: PointerInfo): Rect {
    const x = Math.min(origin.x, info.x)
    const y = Math.min(origin.y, info.y)
    const width = Math.abs(info.x - origin.x)
    const height = Math.abs(info.y - origin.y)
    return { x, y, width, height }
  }

  function updateBrushEl(rect: Rect) {
    brushEl.classList.add('visible')
    brushEl.style.setProperty('left',   `${rect.x}px`)
    brushEl.style.setProperty('top',    `${rect.y}px`)
    brushEl.style.setProperty('width',  `${rect.width}px`)
    brushEl.style.setProperty('height', `${rect.height}px`)
  }

  function getIntersecting(rect: Rect): Set<string> {
    const ids = new Set<string>()
    if (rect.width < 2 && rect.height < 2) return ids
    for (const shape of Object.values(doc.shapes)) {
      if (rectsIntersect(rect, shapeBounds(shape))) {
        ids.add(shape.id)
      }
    }
    return ids
  }

  return {
    update(info: PointerInfo) {
      current = getBrushRect(info)
      updateBrushEl(current)
      onSelectionChange(getIntersecting(current))
    },

    complete(info: PointerInfo) {
      current = getBrushRect(info)
      brushEl.classList.remove('visible')
      onSelectionChange(getIntersecting(current))
    },

    cancel() {
      brushEl.classList.remove('visible')
      onSelectionChange(new Set())
    },
  }
}
