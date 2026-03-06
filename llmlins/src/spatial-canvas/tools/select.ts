import type {
  Session, PointerInfo, Camera, CanvasDoc, CanvasShape, DocHandle
} from '../types.js'
import { pointInShape } from '../math/rect.js'
import { createTranslateSession } from '../sessions/translate.js'
import { createResizeSession, type HandleEdge } from '../sessions/resize.js'
import { createBrushSession } from '../sessions/brush.js'
import { deleteShapes } from '../commands.js'
import { PerformanceMode, applyPerformanceMode } from '../performance.js'

/**
 * Screen-pixel distance before a pointer-down on a shape upgrades from
 * "pointing" to a live TranslateSession. Prevents micro-drags (single-pixel
 * mouse jitter on click) from writing to Automerge.
 */
const DEAD_ZONE = 3

export interface SelectToolContext {
  getCamera(): Camera
  getDoc(): CanvasDoc
  getHandle(): DocHandle<CanvasDoc>
  getSelectedIds(): Set<string>
  setSelectedIds(ids: Set<string>): void
  getBrushEl(): HTMLElement
  getContainer(): HTMLElement
  /** Current bounding rect of the canvas element — used to convert page→screen for elementFromPoint. */
  getCanvasBounds(): DOMRect
  onTranslatePreview(moves: Map<string, { x: number; y: number }>): void
  onResizePreview(id: string, next: Partial<CanvasShape>): void
}

/**
 * SelectTool — persistent pointer event router for the default selection mode.
 *
 * State machine:
 *   Idle
 *     → pointer-down on handle   → ResizeSession (immediate)
 *     → pointer-down on shape    → "PointingBounds" pending state
 *     → pointer-down on canvas   → BrushSession (immediate)
 *
 *   PointingBounds (pointer held, no session yet)
 *     → move > DEAD_ZONE px      → TranslateSession starts
 *     → pointer-up               → click — update selection only, no session
 */
export function createSelectTool(ctx: SelectToolContext) {
  let session: Session | null = null

  /** Set when pointer is down on a shape but hasn't yet exceeded the dead zone. */
  let pendingTranslate: {
    hitShape: CanvasShape
    originX: number   // page coords at pointer-down
    originY: number
  } | null = null

  function hitTestShapes(x: number, y: number): CanvasShape | null {
    const doc = ctx.getDoc()
    const shapes = Object.values(doc.shapes)
      .sort((a, b) => b.zIndex - a.zIndex) // highest z first

    for (const shape of shapes) {
      if (pointInShape(shape, x, y)) return shape
    }
    return null
  }

  function hitTestHandle(pageX: number, pageY: number, camera: Camera): HandleEdge | null {
    const canvasBounds = ctx.getCanvasBounds()
    // Convert page coords → client (viewport) coords so elementFromPoint works
    // regardless of where the canvas element sits in the page.
    // screenX = (pageX + camera.x) * camera.zoom + canvasBounds.left
    const clientX = (pageX + camera.x) * camera.zoom + canvasBounds.left
    const clientY = (pageY + camera.y) * camera.zoom + canvasBounds.top
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    if (!el) return null
    // elementFromPoint returns the innermost element (e.g. .sc-handle-visual).
    // Walk up to find the ancestor that carries data-edge or data-corner.
    const handle = el.closest('[data-edge],[data-corner]') as HTMLElement | null
    if (!handle) return null
    return (handle.dataset.edge || handle.dataset.corner) as HandleEdge
  }

  function startTranslateSession(info: PointerInfo) {
    const doc = ctx.getDoc()
    const handle = ctx.getHandle()
    applyPerformanceMode(PerformanceMode.TranslateSelected, ctx.getContainer())
    session = createTranslateSession(
      ctx.getSelectedIds(),
      doc,
      handle,
      ctx.onTranslatePreview
    )
  }

  return {
    onPointerDown(info: PointerInfo) {
      const camera = ctx.getCamera()
      const selectedIds = ctx.getSelectedIds()

      // 1. Handle hit → ResizeSession (immediate, no dead zone)
      const edge = hitTestHandle(info.x, info.y, camera)
      if (edge && selectedIds.size === 1) {
        const [id] = selectedIds
        const doc = ctx.getDoc()
        const handle = ctx.getHandle()
        applyPerformanceMode(PerformanceMode.TransformSelected, ctx.getContainer())
        session = createResizeSession(id, edge, doc, handle, ctx.onResizePreview)
        return
      }

      // 2. Shape hit → enter PointingBounds pending state (dead zone before translate)
      const hit = hitTestShapes(info.x, info.y)
      if (hit) {
        // Update selection immediately so the visual feedback is instant
        if (info.shiftKey && selectedIds.has(hit.id)) {
          // Shift-click already-selected: deselect it
          const next = new Set(selectedIds)
          next.delete(hit.id)
          ctx.setSelectedIds(next)
          // Don't enter pending state — no drag makes sense after deselect
          return
        }
        if (!selectedIds.has(hit.id)) {
          ctx.setSelectedIds(
            info.shiftKey
              ? new Set([...selectedIds, hit.id])
              : new Set([hit.id])
          )
        }
        pendingTranslate = { hitShape: hit, originX: info.x, originY: info.y }
        return
      }

      // 3. Miss → BrushSession
      if (!info.shiftKey) ctx.setSelectedIds(new Set())
      session = createBrushSession(
        { x: info.x, y: info.y },
        ctx.getDoc(),
        ctx.getBrushEl(),
        ctx.setSelectedIds
      )
    },

    onPointerMove(info: PointerInfo) {
      if (pendingTranslate) {
        const camera = ctx.getCamera()
        // Distance in screen pixels
        const dx = (info.x - pendingTranslate.originX) * camera.zoom
        const dy = (info.y - pendingTranslate.originY) * camera.zoom
        const distPx = Math.hypot(dx, dy)
        if (distPx > DEAD_ZONE) {
          pendingTranslate = null
          startTranslateSession(info)
          // Feed the accumulated delta into the new session immediately
          session?.update(info)
        }
        return
      }
      session?.update(info)
    },

    onPointerUp(info: PointerInfo) {
      if (pendingTranslate) {
        // Pointer lifted before dead zone: it was a click, not a drag.
        // Selection was already updated on pointer-down — nothing more to do.
        pendingTranslate = null
        applyPerformanceMode(PerformanceMode.Idle, ctx.getContainer())
        return
      }
      session?.complete(info)
      session = null
      applyPerformanceMode(PerformanceMode.Idle, ctx.getContainer())
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const ids = ctx.getSelectedIds()
        if (ids.size > 0) {
          deleteShapes(ctx.getHandle(), ids)
          ctx.setSelectedIds(new Set())
        }
      }
      if (e.key === 'Escape') {
        pendingTranslate = null
        session?.cancel()
        session = null
        ctx.setSelectedIds(new Set())
        applyPerformanceMode(PerformanceMode.Idle, ctx.getContainer())
      }
    },

    cancel() {
      pendingTranslate = null
      session?.cancel()
      session = null
    },
  }
}
