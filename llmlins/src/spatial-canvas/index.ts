import type { CanvasDoc, DocHandle, Disposer } from './types.js'
import { CanvasView } from './canvas.js'
import { RectangleDatatype, RectangleTool, rectanglePlugins } from './rectangle.js'

export type { CanvasDoc, CanvasShape } from './types.js'

// ============================================================================
// Spatial Canvas Datatype
// ============================================================================

export const SpatialCanvasDatatype = {
  init(doc: CanvasDoc) {
    doc.shapes = {}
  },

  getTitle(_doc: CanvasDoc): string {
    return 'Spatial Canvas'
  },

  markCopy(_doc: CanvasDoc) {
    // Canvas has no meaningful title to prefix
  },
}

// ============================================================================
// Spatial Canvas Tool
//
// The tool function receives a DocHandle<CanvasDoc> and a mount element.
// It constructs a CanvasView, wiring up the rectangle tool as the default
// content renderer and shape-creation target.
//
// createChildDoc is not provided by the patchwork platform in this stub —
// it falls back to creating a simple in-memory rectangle doc.
// ============================================================================

export function Tool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement
): Disposer {
  // In a real patchwork environment, createChildDoc would call the platform
  // API to create a new synced Automerge document. Here we provide a minimal
  // fallback that creates a local doc handle.
  const createChildDoc = (_toolId: string): string => {
    const fakeUrl = `automerge:${Math.random().toString(36).slice(2)}`
    return fakeUrl
  }

  // Wire the rectangle tool as the content renderer for shapes
  const mountContent = (container: HTMLElement, shape: { docUrl: string; toolId: string }) => {
    if (shape.toolId === 'rectangle') {
      // Create a minimal in-memory doc handle for the rectangle
      let rectDoc = { color: '#4f8ef7', label: '' }
      RectangleDatatype.init(rectDoc)

      type ChangeListener = (p: { doc: typeof rectDoc }) => void
      const listeners = new Set<ChangeListener>()

      const rectHandle = {
        doc: () => rectDoc,
        on:  (_ev: 'change', cb: ChangeListener) => { listeners.add(cb) },
        off: (_ev: 'change', cb: ChangeListener) => { listeners.delete(cb) },
        change: (fn: (d: typeof rectDoc) => void) => {
          fn(rectDoc)
          for (const cb of listeners) cb({ doc: rectDoc })
        },
      }

      return RectangleTool(rectHandle, container)
    }

    // Default: <patchwork-view>
    const pw = document.createElement('patchwork-view') as HTMLElement
    pw.setAttribute('doc-url', shape.docUrl)
    pw.setAttribute('tool-id', shape.toolId)
    pw.style.cssText = 'width:100%;height:100%;display:block;pointer-events:auto;'
    container.appendChild(pw)
    return () => pw.remove()
  }

  const view = new CanvasView(handle, element, { createChildDoc, mountContent })
  return () => view.dispose()
}

// ============================================================================
// Plugin exports
// ============================================================================

export const plugins = [
  {
    type: 'patchwork:datatype' as const,
    id: 'spatial-canvas',
    name: 'Spatial Canvas',
    icon: 'Globe',
    async load() {
      return SpatialCanvasDatatype
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas',
    name: 'Spatial Canvas',
    icon: 'Globe',
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return Tool
    },
  },
  ...rectanglePlugins,
]

export { RectangleDatatype, RectangleTool }
