import { createElement, Type } from 'lucide'
import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import type { TextShape } from './text.js'

interface PointerDetail {
  canvasX: number
  canvasY: number
}

const DEFAULT_COLOR = '#1a1a1a'

export default function PlaceTextTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: HTMLElement,
): Disposer {
  const icon = createElement(Type, { width: 22, height: 22, style: 'pointer-events:none' })
  buttonEl.appendChild(icon)

  let downAt: { canvasX: number; canvasY: number } | null = null

  function getColor(): string {
    const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'
    return handle.doc()?.stateByUser?.[contactUrl]?.color ?? DEFAULT_COLOR
  }

  function getFontSize(): number {
    const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'
    return handle.doc()?.stateByUser?.[contactUrl]?.fontSize ?? 18
  }

  function onPointerDown(e: Event) {
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    downAt = { canvasX, canvasY }
  }

  function onPointerUp(e: Event) {
    if (!downAt) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    const dx = canvasX - downAt.canvasX
    const dy = canvasY - downAt.canvasY

    if (Math.sqrt(dx * dx + dy * dy) <= 4) {
      const doc = handle.doc()
      const shape: TextShape = {
        id: newId(),
        type: 'text',
        x: downAt.canvasX,
        y: downAt.canvasY,
        zIndex: doc ? nextZIndex(doc) : 0,
        text: '',
        color: getColor(),
        fontSize: getFontSize(),
      }
      createShape(handle, shape)
    }

    downAt = null
  }

  function onCancel() { downAt = null }

  buttonEl.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  buttonEl.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  buttonEl.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    buttonEl.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    buttonEl.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    buttonEl.removeEventListener('spatial-canvas:cancel',      onCancel)
    icon.remove()
  }
}
