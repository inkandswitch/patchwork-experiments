import type { CanvasShape, CanvasDoc, Camera, Rect, MountedShape, Disposer } from './types.js'
import { computeViewport } from './camera.js'
import { rectsIntersect, shapeBounds } from './math/rect.js'
import { mountShape } from './shape-mount.js'

export type ContentMounter = (container: HTMLElement, shape: CanvasShape) => Disposer

export interface ShapeTree {
  /** Call whenever the viewport may have changed (camera, resize, doc change). */
  updateViewport(camera: Camera, screenBounds: Rect, doc: CanvasDoc, selectedIds: Set<string>): void
  /** Return the currently mounted shape for hit-testing etc. */
  getMounted(): ReadonlyMap<string, MountedShape>
  /** Update selection visual state after selectedIds changes without a full reconcile. */
  syncSelection(selectedIds: Set<string>): void
  dispose(): void
}

/**
 * Create a keyed DOM reconciler for the shape layer.
 *
 * Keeps a Map<id, MountedShape> mirroring what is currently in the DOM.
 * On each updateViewport call:
 *   - Shapes that entered the viewport are mounted.
 *   - Shapes already mounted get updatePosition() called if their data changed.
 *   - Shapes that left the viewport are unmounted.
 *
 * No framework — just a Map and direct DOM calls.
 */
export function createShapeTree(
  shapesContainer: HTMLElement,
  mountContent: ContentMounter
): ShapeTree {
  const mounted = new Map<string, MountedShape>()
  // Track last-seen shape data to avoid unnecessary updatePosition calls
  const lastSeen = new Map<string, CanvasShape>()

  function updateViewport(
    camera: Camera,
    screenBounds: Rect,
    doc: CanvasDoc,
    selectedIds: Set<string>
  ): void {
    const viewport = computeViewport(camera, screenBounds)
    const all = Object.values(doc.shapes)

    const visible = new Set(
      all
        .filter(shape =>
          selectedIds.has(shape.id) ||
          rectsIntersect(viewport, shapeBounds(shape))
        )
        .map(s => s.id)
    )

    // Unmount shapes that left the viewport
    for (const [id, mountedShape] of mounted) {
      if (!visible.has(id)) {
        mountedShape.unmount()
        mounted.delete(id)
        lastSeen.delete(id)
      }
    }

    // Mount new or update existing visible shapes
    const visibleShapes = all.filter(s => visible.has(s.id))

    for (const shape of visibleShapes) {
      const existing = mounted.get(shape.id)
      if (!existing) {
        // Mount new shape
        const ms = mountShape(shape, shapesContainer, mountContent)
        ms.setSelected(selectedIds.has(shape.id))
        mounted.set(shape.id, ms)
        lastSeen.set(shape.id, shape)
      } else {
        const prev = lastSeen.get(shape.id)
        // Update position only if shape data changed
        if (prev !== shape) {
          existing.updatePosition(shape)
          lastSeen.set(shape.id, shape)
        }
      }
    }
  }

  function syncSelection(selectedIds: Set<string>): void {
    for (const [id, ms] of mounted) {
      ms.setSelected(selectedIds.has(id))
    }
  }

  function dispose(): void {
    for (const ms of mounted.values()) {
      ms.unmount()
    }
    mounted.clear()
    lastSeen.clear()
  }

  return { updateViewport, getMounted: () => mounted, syncSelection, dispose }
}
