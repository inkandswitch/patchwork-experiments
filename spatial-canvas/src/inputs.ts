import type { Camera, PointerInfo, Vec2 } from './types.js'

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

  private lastX = 0
  private lastY = 0
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
    this.lastX = page.x
    this.lastY = page.y
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
      dx: page.x - this.lastX,
      dy: page.y - this.lastY,
      origin: this.origin,
      pointerId: e.pointerId,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    }
    this.lastX = page.x
    this.lastY = page.y
    return info
  }

  onPointerUp(e: PointerEvent, camera: Camera): PointerInfo {
    const page = this.screenToPage(e.clientX, e.clientY, camera)
    const info: PointerInfo = {
      x: page.x,
      y: page.y,
      dx: page.x - this.lastX,
      dy: page.y - this.lastY,
      origin: this.origin,
      pointerId: e.pointerId,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
    }
    this.lastX = page.x
    this.lastY = page.y
    return info
  }
}
