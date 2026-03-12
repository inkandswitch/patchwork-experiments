import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import type { RectangleFill, RectangleShape } from './rectangle.js'
import { createElement, Square } from 'lucide'

interface PointerDetail {
  canvasX: number
  canvasY: number
}

const DEFAULT_COLOR = '#4f8ef7'
const DEFAULT_FILL: RectangleFill = 'filled'


/** Mix hex color toward white by factor t (0 = original, 1 = white). */
function lightenColor(hex: string, t = 0.72): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`
}

export default function PlaceRectangleTool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement
): Disposer {
  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'

  const icon = createElement(Square, { width: 22, height: 22, style: 'pointer-events:none' })
  element.appendChild(icon)

  let origin: { x: number; y: number } | null = null
  let preview: HTMLDivElement | null = null

  function getColor(): string {
    return handle.doc()?.stateByUser?.[contactUrl]?.color ?? DEFAULT_COLOR
  }

  function getFill(): RectangleFill {
    return handle.doc()?.stateByUser?.[contactUrl]?.fill ?? DEFAULT_FILL
  }

  function getLayer(): HTMLElement | null {
    return element.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
  }

  function previewBackground(color: string, fill: RectangleFill): string {
    if (fill === 'transparent') return 'transparent'
    if (fill === 'white') return 'white'
    return lightenColor(color)
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
    const color = getColor()
    const fill = getFill()

    preview = document.createElement('div')
    preview.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'border-radius:8px',
      'pointer-events:none',
      'z-index:2147483647',
      `background:${previewBackground(color, fill)}`,
      `outline:2.5px solid ${color}`,
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
        color: getColor(),
        fill: getFill(),
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

  element.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  element.addEventListener('spatial-canvas:pointermove', onPointerMove)
  element.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  element.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    element.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    element.removeEventListener('spatial-canvas:pointermove', onPointerMove)
    element.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    element.removeEventListener('spatial-canvas:cancel',      onCancel)
    icon.remove()
    cleanup()
  }
}
