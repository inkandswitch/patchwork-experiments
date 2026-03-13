import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc } from '../core/types.js'
import type { RectangleShape } from './rectangle.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'

/** Mix color with white by `t` (0 = original, 1 = white). */
function lightenColor(hex: string, t = 0.72): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * t)
  const lg = Math.round(g + (255 - g) * t)
  const lb = Math.round(b + (255 - b) * t)
  return `rgb(${lr},${lg},${lb})`
}

/**
 * RectangleLayer — renders all shapes with type === 'rectangle' as
 * positioned divs inside the provided container element.
 */
export default function RectangleLayer(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement
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
        el.style.cssText = 'position:absolute;top:0;left:0;border-radius:8px;'
        el.dataset.shapeId = rect.id
        element.appendChild(el)
        mounted.set(rect.id, el)
      }

      const color = rect.color ?? '#4f8ef7'
      const fill = rect.fill ?? 'filled'

      el.style.transform = `translate(${rect.x}px, ${rect.y}px)`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
      el.style.zIndex = String(rect.zIndex)
      el.style.outline = `2.5px solid ${color}`

      if (fill === 'transparent') {
        el.style.background = 'transparent'
      } else if (fill === 'white') {
        el.style.background = 'white'
      } else {
        el.style.background = lightenColor(color)
      }
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
