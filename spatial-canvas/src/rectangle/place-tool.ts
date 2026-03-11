import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import type { RectangleShape } from './rectangle.js'

interface PointerDetail {
  canvasX: number
  canvasY: number
}

export default function PlaceRectangleTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: HTMLElement
): Disposer {
  let origin: { x: number; y: number } | null = null
  let preview: HTMLDivElement | null = null

  // buttonEl lives in .sc-toolbar; .sc-layer is a sibling inside .sc-container
  function getLayer(): HTMLElement | null {
    return buttonEl.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
  }

  function updatePreview(ax: number, ay: number, bx: number, by: number) {
    if (!preview) return
    const x = Math.min(ax, bx)
    const y = Math.min(ay, by)
    const w = Math.abs(bx - ax)
    const h = Math.abs(by - ay)
    preview.style.transform = `translate(${x}px, ${y}px)`
    preview.style.width  = `${w}px`
    preview.style.height = `${h}px`
  }

  function onPointerDown(e: Event) {
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    origin = { x: canvasX, y: canvasY }

    preview = document.createElement('div')
    preview.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'box-sizing:border-box',
      'pointer-events:none',
      'background:rgba(79,142,247,0.15)',
      'border:1.5px dashed #4f8ef7',
    ].join(';')

    updatePreview(canvasX, canvasY, canvasX, canvasY)
    getLayer()?.appendChild(preview)
  }

  function onPointerMove(e: Event) {
    if (!origin || !preview) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    updatePreview(origin.x, origin.y, canvasX, canvasY)
  }

  function onPointerUp(e: Event) {
    if (!origin) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    const x = Math.min(origin.x, canvasX)
    const y = Math.min(origin.y, canvasY)
    const width  = Math.abs(canvasX - origin.x)
    const height = Math.abs(canvasY - origin.y)

    if (width > 4 && height > 4) {
      const doc = handle.doc()
      const zIndex = doc ? nextZIndex(doc) : 0
      const shape: RectangleShape = {
        id: newId(),
        type: 'rectangle',
        x,
        y,
        width,
        height,
        zIndex,
      }
      createShape(handle, shape)
    }

    cleanup()
  }

  function onCancel() {
    cleanup()
  }

  function cleanup() {
    preview?.remove()
    preview = null
    origin = null
  }

  buttonEl.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  buttonEl.addEventListener('spatial-canvas:pointermove', onPointerMove)
  buttonEl.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  buttonEl.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    buttonEl.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    buttonEl.removeEventListener('spatial-canvas:pointermove', onPointerMove)
    buttonEl.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    buttonEl.removeEventListener('spatial-canvas:cancel',      onCancel)
    cleanup()
  }
}
