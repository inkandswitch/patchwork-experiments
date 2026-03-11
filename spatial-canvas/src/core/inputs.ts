import type { Camera, PointerInfo, Vec2 } from './types.js'

/**
 * Convert a client-space (screen) coordinate to canvas (page) space.
 * Reads --sc-zoom / --sc-x / --sc-y CSS variables set by updateCamera, and
 * uses the .sc-canvas bounding rect for the viewport offset.
 *
 * Works from any element inside .sc-container — useful for drop handlers and
 * other code that doesn't go through the tool event pipeline.
 */
export function screenToCanvas(element: Element, clientX: number, clientY: number): Vec2 {
  const container = element.closest('.sc-container') as HTMLElement | null
  const canvasEl  = element.closest('.sc-canvas')  as HTMLElement | null
  if (!container || !canvasEl) return { x: clientX, y: clientY }

  const style = getComputedStyle(container)
  const zoom  = parseFloat(style.getPropertyValue('--sc-zoom')) || 1
  const camX  = parseFloat(style.getPropertyValue('--sc-x'))   || 0
  const camY  = parseFloat(style.getPropertyValue('--sc-y'))   || 0
  const rect  = canvasEl.getBoundingClientRect()

  return {
    x: (clientX - rect.left) / zoom - camX,
    y: (clientY - rect.top)  / zoom - camY,
  }
}

/**
 * Normalizes raw PointerEvents into typed page-coordinate PointerInfo objects.
 *
 * `bounds` must be kept current (call updateBounds on resize) so that
 * screenToPage correctly subtracts the canvas element's viewport offset.
 * Without this subtraction, all coordinates are wrong when the canvas is
 * embedded in a panel rather than filling the entire viewport.
 */
export class Inputs {
  /** Current bounding rect of the canvas element — updated by CanvasView. */
  bounds: DOMRect = new DOMRect(0, 0, 0, 0)

  // Stored in screen space (raw clientX/Y) so that camera changes between
  // frames (during pan) do not invalidate the delta. If we stored in page
  // space, a pan that updates camera.x would make the next frame's pageX equal
  // to lastPageX, yielding dx=0 every other frame and causing 2× speed lag.
  private lastScreenX = 0
  private lastScreenY = 0
  private origin: Vec2 = { x: 0, y: 0 }

  updateBounds(rect: DOMRect) {
    this.bounds = rect
  }

  screenToPage(screenX: number, screenY: number, camera: Camera): Vec2 {
    return {
      x: (screenX - this.bounds.left) / camera.zoom - camera.x,
      y: (screenY - this.bounds.top)  / camera.zoom - camera.y,
    }
  }

  onPointerDown(e: PointerEvent, camera: Camera): PointerInfo {
    const page = this.screenToPage(e.clientX, e.clientY, camera)
    this.lastScreenX = e.clientX
    this.lastScreenY = e.clientY
    this.origin = { x: page.x, y: page.y }

    return {
      x: page.x,
      y: page.y,
      dx: 0,
      dy: 0,
      origin: this.origin,
      pointerId: e.pointerId,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    }
  }

  onPointerMove(e: PointerEvent, camera: Camera): PointerInfo {
    const page = this.screenToPage(e.clientX, e.clientY, camera)
    const info: PointerInfo = {
      x: page.x,
      y: page.y,
      dx: (e.clientX - this.lastScreenX) / camera.zoom,
      dy: (e.clientY - this.lastScreenY) / camera.zoom,
      origin: this.origin,
      pointerId: e.pointerId,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    }
    this.lastScreenX = e.clientX
    this.lastScreenY = e.clientY
    return info
  }

  onPointerUp(e: PointerEvent, camera: Camera): PointerInfo {
    const page = this.screenToPage(e.clientX, e.clientY, camera)
    const info: PointerInfo = {
      x: page.x,
      y: page.y,
      dx: (e.clientX - this.lastScreenX) / camera.zoom,
      dy: (e.clientY - this.lastScreenY) / camera.zoom,
      origin: this.origin,
      pointerId: e.pointerId,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    }
    this.lastScreenX = e.clientX
    this.lastScreenY = e.clientY
    return info
  }
}
