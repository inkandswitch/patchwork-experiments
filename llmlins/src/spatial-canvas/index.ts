import type { CanvasDoc, DocHandle, Disposer } from './types.js'
import { CanvasView } from './canvas.js'

type ToolElement = HTMLElement

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
// It constructs a CanvasView. Shape rendering is handled by the default
// shapeType dispatch (embed → mountEmbed, token → mountToken).
//
// createChildDoc is not provided by the patchwork platform in this stub —
// it falls back to creating a fake URL for local development.
// ============================================================================

export function Tool(
  handle: DocHandle<CanvasDoc>,
  element: ToolElement
): Disposer {
  const view = new CanvasView(handle, element)
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
]

export { mountEmbed } from './embed.js'
export { mountToken } from './token.js'
