import type { Session, PointerInfo, Camera } from '../types.js'
import { createPanSession } from '../sessions/pan.js'
import { PerformanceMode, applyPerformanceMode } from '../performance.js'

export interface PanToolContext {
  getCamera(): Camera
  getContainer(): HTMLElement
  getLayer(): HTMLElement
  onViewport(camera: Camera): void
  onCameraChange(camera: Camera): void
}

/**
 * PanTool — active when the user holds Space or clicks the middle button.
 * Delegates drag handling to PanSession.
 */
export function createPanTool(ctx: PanToolContext) {
  let session: Session | null = null

  return {
    onPointerDown(info: PointerInfo) {
      applyPerformanceMode(PerformanceMode.TranslateAll, ctx.getContainer())
      session = createPanSession(
        ctx.getCamera(),
        ctx.getContainer(),
        ctx.getLayer(),
        ctx.onViewport,
        ctx.onCameraChange
      )
    },

    onPointerMove(info: PointerInfo) {
      session?.update(info)
    },

    onPointerUp(info: PointerInfo) {
      session?.complete(info)
      session = null
      applyPerformanceMode(PerformanceMode.Idle, ctx.getContainer())
    },

    cancel() {
      session?.cancel()
      session = null
      applyPerformanceMode(PerformanceMode.Idle, ctx.getContainer())
    },
  }
}
