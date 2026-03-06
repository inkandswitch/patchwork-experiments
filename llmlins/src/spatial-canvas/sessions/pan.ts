import type { Session, PointerInfo, Camera } from '../types.js'
import { updateCamera } from '../camera.js'

/**
 * PanSession — drag to pan the camera.
 * Ephemeral: complete() returns nothing; no undo entry created.
 */
export function createPanSession(
  initialCamera: Camera,
  container: HTMLElement,
  layer: HTMLElement,
  onViewport: (camera: Camera) => void,
  onCameraChange: (camera: Camera) => void
): Session {
  let camera = initialCamera

  return {
    update(info: PointerInfo) {
      const next: Camera = {
        ...camera,
        x: camera.x + info.dx,
        y: camera.y + info.dy,
      }
      camera = updateCamera(next, container, layer, onViewport)
      onCameraChange(camera)
    },

    complete(_info: PointerInfo) {
      // No undo entry — camera state is ephemeral
    },

    cancel() {
      // Restore initial camera
      camera = updateCamera(initialCamera, container, layer, onViewport)
      onCameraChange(camera)
    },
  }
}
