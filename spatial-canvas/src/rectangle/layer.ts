import type { CanvasDoc, DocHandle } from '../core/types.js'
import type { RectangleShape } from './rectangle.js'

/**
 * RectangleLayer — renders all shapes with type === 'rectangle' as
 * positioned divs inside the provided container element.
 *
 * The container lives inside .sc-layer which already has the camera CSS
 * transform applied, so shapes only need translate(x, y) positioning.
 * The container itself has no z-index, so it does not create a stacking
 * context — each shape element's own z-index (from shape.zIndex) is
 * compared directly against elements from other layers, enabling true
 * cross-layer z-ordering.
 */
export default function RectangleLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement
): () => void {
  const mounted = new Map<string, HTMLElement>()
  element.style.cssText = 'position:absolute;inset:0;'

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'rectangle') currentIds.add(shape.id)
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'rectangle') continue
      const rect = shape as RectangleShape

      let el = mounted.get(rect.id)
      if (!el) {
        el = document.createElement('div')
        el.style.cssText = 'position:absolute;top:0;left:0;box-sizing:border-box;'
        el.dataset.shapeId = rect.id
        element.appendChild(el)
        mounted.set(rect.id, el)
      }

      el.style.transform = `translate(${rect.x}px, ${rect.y}px)`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
      el.style.zIndex = String(rect.zIndex)
      el.style.background = '#4f8ef7'
      el.style.border = '1.5px solid #2255cc'
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  return () => {
    handle.off('change', render)
    for (const el of mounted.values()) el.remove()
    mounted.clear()
  }
}
