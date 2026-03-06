import type { AutomergeUrl, PointerInfo, CanvasDoc, DocHandle } from '../types.js'
import { createShape, newId, nextZIndex } from '../commands.js'

export interface PlaceToolContext {
  getDoc(): CanvasDoc
  getHandle(): DocHandle<CanvasDoc>
  /** Called after placing to switch back to select tool. */
  onPlaced(): void
  /** Create a new child Automerge document and return its URL, or undefined to leave unset. */
  createChildDoc(datatypeId: string): AutomergeUrl | undefined
  /** Returns the currently selected datatype id to create on place. */
  getDatatypeId(): string
  /** Overlay element (inside the layer) used to show the drag preview. */
  getPlacePreviewEl(): HTMLElement
}

const DEFAULT_WIDTH  = 400
const DEFAULT_HEIGHT = 300
const MIN_SIZE       = 16
// Must exceed this screen-pixel distance to be treated as a drag
const DRAG_THRESHOLD = 4

function computeRect(x1: number, y1: number, x2: number, y2: number) {
  return {
    x:      Math.min(x1, x2),
    y:      Math.min(y1, y2),
    width:  Math.max(Math.abs(x2 - x1), MIN_SIZE),
    height: Math.max(Math.abs(y2 - y1), MIN_SIZE),
  }
}

/**
 * PlaceTool — drag on the canvas to draw out a new embed shape.
 * Shows a live dashed-border preview while dragging; commits to Automerge
 * on pointer-up. A simple click (below DRAG_THRESHOLD) places a default-
 * sized shape centred on the click point.
 */
export function createPlaceTool(ctx: PlaceToolContext) {
  let origin: { x: number; y: number } | null = null
  let isDragging = false

  function showPreview(x: number, y: number, width: number, height: number) {
    const el = ctx.getPlacePreviewEl()
    el.style.cssText = [
      'position:absolute',
      'box-sizing:border-box',
      'pointer-events:none',
      'border:2px dashed #4f8ef7',
      'border-radius:2px',
      `left:${x}px`,
      `top:${y}px`,
      `width:${width}px`,
      `height:${height}px`,
      'display:block',
    ].join(';')
  }

  function hidePreview() {
    ctx.getPlacePreviewEl().style.display = 'none'
  }

  function commit(rect: { x: number; y: number; width: number; height: number }) {
    hidePreview()
    const doc    = ctx.getDoc()
    const handle = ctx.getHandle()
    const docUrl = ctx.createChildDoc(ctx.getDatatypeId())
    const shape: Parameters<typeof createShape>[1] = {
      id:        newId(),
      x:         rect.x,
      y:         rect.y,
      width:     rect.width,
      height:    rect.height,
      rotation:  0,
      zIndex:    nextZIndex(doc),
      shapeType: 'embed',
    }
    if (docUrl !== undefined) shape.docUrl = docUrl
    createShape(handle, shape)
    ctx.onPlaced()
  }

  return {
    onPointerDown(info: PointerInfo) {
      origin     = { x: info.x, y: info.y }
      isDragging = false
      // Show a 1×1 seed so the preview element exists during the drag
      showPreview(info.x, info.y, 1, 1)
    },

    onPointerMove(info: PointerInfo) {
      if (!origin) return
      isDragging = true
      const rect = computeRect(origin.x, origin.y, info.x, info.y)
      showPreview(rect.x, rect.y, rect.width, rect.height)
    },

    onPointerUp(info: PointerInfo) {
      if (!origin) return
      const start = origin
      origin     = null

      if (isDragging) {
        isDragging = false
        commit(computeRect(start.x, start.y, info.x, info.y))
      } else {
        // Simple click → default-sized shape centred on cursor
        commit({
          x:      info.x - DEFAULT_WIDTH  / 2,
          y:      info.y - DEFAULT_HEIGHT / 2,
          width:  DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
        })
      }
    },

    cancel() {
      origin     = null
      isDragging = false
      hidePreview()
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        origin     = null
        isDragging = false
        hidePreview()
        ctx.onPlaced()
      }
    },
  }
}
