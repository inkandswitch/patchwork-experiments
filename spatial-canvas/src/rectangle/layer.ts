import type { CanvasDoc, DocHandle } from '../core/types.js'

/**
 * RectangleLayer — renders all shapes with toolId === 'rectangle' as
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
    // Collect ids of rectangle shapes currently in the doc
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.toolId === 'rectangle') currentIds.add(shape.id)
    }

    // Remove elements for shapes that are gone or changed type
    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
    }

    // Add or update elements for current rectangle shapes
    for (const shape of Object.values(doc.shapes)) {
      if (shape.toolId !== 'rectangle') continue

      let el = mounted.get(shape.id)
      if (!el) {
        el = document.createElement('div')
        el.style.cssText = 'position:absolute;top:0;left:0;box-sizing:border-box;'
        element.appendChild(el)
        mounted.set(shape.id, el)
      }

      el.style.transform = `translate(${shape.x}px, ${shape.y}px)`
      el.style.width = `${shape.width}px`
      el.style.height = `${shape.height}px`
      el.style.zIndex = String(shape.zIndex)
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
