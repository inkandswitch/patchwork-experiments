import type { CanvasDoc, DocHandle, Disposer } from './types.js'
import type { Repo } from '@automerge/automerge-repo'
import { CanvasView } from './canvas.js'

type ToolElement = HTMLElement & { repo: Repo }

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

const LLMLIN_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25"/>
  <path d="M3.5 8 C5 5.5 11 5.5 12.5 8 C11 10.5 5 10.5 3.5 8Z" stroke="currentColor" stroke-width="1.1" fill="none"/>
  <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
</svg>`

export function Tool(
  handle: DocHandle<CanvasDoc>,
  element: ToolElement
): Disposer {
  const view = new CanvasView(handle, element, {
    quickPlaceButtons: [
      {
        id: 'llmlin',
        label: LLMLIN_ICON,
        title: 'Create LLMlin',
        datatypeId: 'llmlin',
        shapeType: 'bare',
      },
    ],
  })
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

export { mountEmbed, type ToolOption } from './embed.js'
export { mountToken } from './token.js'
export type { DatatypeOption, QuickPlaceButton } from './canvas.js'
