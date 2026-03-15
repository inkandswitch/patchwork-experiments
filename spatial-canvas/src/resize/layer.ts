import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, Disposer } from '../canvas/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import { patchShape } from '../canvas/commands.js'
import { screenToCanvas } from '../canvas/inputs.js'

const MIN_SIZE = 10

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface HandleDef {
  type: HandleType
  cursor: string
  style: string
}

const H = 12 // handle size in px — fully outside the bounding box

const HANDLES: HandleDef[] = [
  // Corners — H×H squares, flush against the outside corners
  { type: 'nw', cursor: 'nwse-resize', style: `top:-${H}px;left:-${H}px;width:${H}px;height:${H}px;` },
  { type: 'ne', cursor: 'nesw-resize', style: `top:-${H}px;right:-${H}px;width:${H}px;height:${H}px;` },
  { type: 'se', cursor: 'nwse-resize', style: `bottom:-${H}px;right:-${H}px;width:${H}px;height:${H}px;` },
  { type: 'sw', cursor: 'nesw-resize', style: `bottom:-${H}px;left:-${H}px;width:${H}px;height:${H}px;` },
  // Sides — H px thick strip, running between the corner zones
  { type: 'n', cursor: 'ns-resize',  style: `top:-${H}px;left:0;right:0;height:${H}px;` },
  { type: 's', cursor: 'ns-resize',  style: `bottom:-${H}px;left:0;right:0;height:${H}px;` },
  { type: 'w', cursor: 'ew-resize',  style: `top:0;bottom:0;left:-${H}px;width:${H}px;` },
  { type: 'e', cursor: 'ew-resize',  style: `top:0;bottom:0;right:-${H}px;width:${H}px;` },
]

interface DragState {
  shapeId: string
  handleType: HandleType
  origX: number
  origY: number
  origW: number
  origH: number
  originCanvas: { x: number; y: number }
  handleEl: HTMLElement
}

function computeResize(
  type: HandleType,
  origX: number, origY: number,
  origW: number, origH: number,
  dx: number, dy: number,
): { x: number; y: number; width: number; height: number } {
  let x = origX, y = origY, w = origW, h = origH

  // Horizontal
  if (type === 'nw' || type === 'w' || type === 'sw') {
    w = origW - dx
    if (w < MIN_SIZE) { w = MIN_SIZE }
    x = origX + origW - w
  } else if (type === 'ne' || type === 'e' || type === 'se') {
    w = Math.max(MIN_SIZE, origW + dx)
  }

  // Vertical
  if (type === 'nw' || type === 'n' || type === 'ne') {
    h = origH - dy
    if (h < MIN_SIZE) { h = MIN_SIZE }
    y = origY + origH - h
  } else if (type === 'sw' || type === 's' || type === 'se') {
    h = Math.max(MIN_SIZE, origH + dy)
  }

  return { x, y, width: w, height: h }
}

export default function ResizeLayer(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  element.style.cssText = 'position:absolute;inset:0;pointer-events:none;'

  const mounted = new Map<string, HTMLElement>()

  let drag: DragState | null = null

  // ---- pointer handlers (attached to document to survive pointer capture) ----

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== (drag as any).pointerId) return
    const pos = screenToCanvas(drag.handleEl, e.clientX, e.clientY)
    const dx = pos.x - drag.originCanvas.x
    const dy = pos.y - drag.originCanvas.y
    const patch = computeResize(drag.handleType, drag.origX, drag.origY, drag.origW, drag.origH, dx, dy)
    patchShape(handle, drag.shapeId, patch)
  }

  function onPointerUp() {
    drag = null
  }

  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)

  // ---- render ----

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()

    for (const shape of Object.values(doc.shapes)) {
      const s = shape as any
      if (!('width' in s) || !('height' in s)) continue
      currentIds.add(s.id)
    }

    // Remove wrappers for gone/non-resizable shapes
    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
    }

    // Create / update wrappers
    for (const shape of Object.values(doc.shapes)) {
      const s = shape as any
      if (!('width' in s) || !('height' in s)) continue

      let wrapper = mounted.get(s.id)
      if (!wrapper) {
        wrapper = buildWrapper(s.id)
        element.appendChild(wrapper)
        mounted.set(s.id, wrapper)
      }

      wrapper.style.transform = `translate(${s.x}px,${s.y}px)`
      wrapper.style.width = `${s.width}px`
      wrapper.style.height = `${s.height}px`
      wrapper.style.zIndex = String(s.zIndex + 1)
    }
  }

  function buildWrapper(shapeId: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;'

    for (const def of HANDLES) {
      const h = document.createElement('div')
      h.style.cssText = `position:absolute;${def.style}cursor:${def.cursor};pointer-events:auto;`

      h.addEventListener('pointerdown', (e: PointerEvent) => {
        e.stopPropagation()
        h.setPointerCapture(e.pointerId)

        const doc = handle.doc()
        if (!doc) return
        const shape = doc.shapes[shapeId] as any
        if (!shape) return

        const originCanvas = screenToCanvas(h, e.clientX, e.clientY)

        drag = {
          shapeId,
          handleType: def.type,
          origX: shape.x,
          origY: shape.y,
          origW: shape.width,
          origH: shape.height,
          originCanvas,
          handleEl: h,
          pointerId: e.pointerId,
        } as DragState & { pointerId: number }
      })

      wrapper.appendChild(h)
    }

    return wrapper
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  return () => {
    handle.off('change', render)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    for (const el of mounted.values()) el.remove()
    mounted.clear()
  }
}
