import type { PointerInfo, CanvasDoc, DocHandle } from '../types.js'
import { createShape, newId, nextZIndex } from '../commands.js'

export interface PlaceToolContext {
  getDoc(): CanvasDoc
  getHandle(): DocHandle<CanvasDoc>
  /** Called after placing to switch back to select tool. */
  onPlaced(): void
  /** Create a new child Automerge document and return its URL. */
  createChildDoc(toolId: string): string
}

const DEFAULT_WIDTH  = 200
const DEFAULT_HEIGHT = 150
const DEFAULT_TOOL   = 'rectangle'

/**
 * PlaceTool — click anywhere on the canvas to place a new rectangle shape.
 * Creates a new Automerge document for the shape content, then creates the
 * canvas shape record pointing at it.
 */
export function createPlaceTool(ctx: PlaceToolContext) {
  return {
    onPointerDown(_info: PointerInfo) {
      // Wait for pointer-up to avoid accidental placements on drag
    },

    onPointerMove(_info: PointerInfo) {},

    onPointerUp(info: PointerInfo) {
      const doc = ctx.getDoc()
      const handle = ctx.getHandle()

      const docUrl = ctx.createChildDoc(DEFAULT_TOOL)
      const id = newId()

      createShape(handle, {
        id,
        x: info.x - DEFAULT_WIDTH / 2,
        y: info.y - DEFAULT_HEIGHT / 2,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: nextZIndex(doc),
        docUrl,
        toolId: DEFAULT_TOOL,
      })

      ctx.onPlaced()
    },

    cancel() {},

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') ctx.onPlaced()
    },
  }
}
