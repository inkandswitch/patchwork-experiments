import type { Camera, Rect } from "./types.js";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/**
 * Apply a new camera state directly to the DOM — no framework, no reconciler.
 * Returns the clamped camera that was applied.
 */
export function updateCamera(next: Camera, layer: HTMLElement): Camera {
  const camera: Camera = {
    x: next.x,
    y: next.y,
    zoom: clampZoom(next.zoom),
  };

  // Layer transform — scale then translate (CSS composes right-to-left,
  // so translate executes first in page coordinates, then scale)
  layer.style.setProperty(
    "transform",
    `scale(${camera.zoom}) translateX(${camera.x}px) translateY(${camera.y}px)`,
  );

  return camera;
}

/**
 * Derive the visible rectangle in page coordinates from the camera state.
 */
export function computeViewport(camera: Camera, screenBounds: Rect): Rect {
  return {
    x: -camera.x,
    y: -camera.y,
    width: screenBounds.width / camera.zoom,
    height: screenBounds.height / camera.zoom,
  };
}

/**
 * Convert a screen-space wheel delta into a new camera, zooming towards the
 * pointer position (screenX, screenY).
 */
export function zoomCamera(
  camera: Camera,
  screenX: number,
  screenY: number,
  delta: number,
): Camera {
  const factor = 1 - delta * 0.01;
  const nextZoom = clampZoom(camera.zoom * factor);
  const ratio = nextZoom / camera.zoom;

  // Keep the page point under the pointer stationary
  return {
    zoom: nextZoom,
    x: screenX / nextZoom - (screenX / camera.zoom - camera.x),
    y: screenY / nextZoom - (screenY / camera.zoom - camera.y),
  };
  // Simplified form:
  // x' = (screenX / zoom' ) - (screenX/zoom - x)
  //    = screenX*(1/zoom' - 1/zoom) + x
  //    = screenX*(ratio-1)/zoom' + x  (after algebra)
  void ratio; // unused after simplification above
}
