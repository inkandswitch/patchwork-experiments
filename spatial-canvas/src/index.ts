import type { CanvasDoc, DocHandle, Disposer } from './core/types.js'
import { CanvasView } from './core/canvas.js'
import { rectanglePlugins } from './rectangle/rectangle.js'

export type { CanvasDoc, CanvasShape } from './core/types.js'

// ============================================================================
// Spatial Canvas Datatype
// ============================================================================

export const SpatialCanvasDatatype = {
  init(doc: CanvasDoc) {
    doc.shapes = {}
    doc.selectionByUser = {}
  },

  getTitle(_doc: CanvasDoc): string {
    return 'Spatial Canvas'
  },

  markCopy(_doc: CanvasDoc) {},
}

// ============================================================================
// Spatial Canvas Tool
// ============================================================================

export function Tool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement
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
  ...rectanglePlugins,
  // -------------------------------------------------------------------------
  // Canvas tools (tag: spatial-canvas-tool)
  // Mounted onto toolbar button elements. Listen for spatial-canvas:pointer*
  // CustomEvents and write shapes into the canvas doc directly.
  // -------------------------------------------------------------------------
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-place-rectangle',
    name: 'Rectangle',
    icon: '□',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./rectangle/place-tool.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-pen-black',
    name: 'Pen (Black)',
    icon: '✒',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./pen/pen-tool.js')).PenBlackTool
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-pen-blue',
    name: 'Pen (Blue)',
    icon: '✒',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./pen/pen-tool.js')).PenBlueTool
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-pen-red',
    name: 'Pen (Red)',
    icon: '✒',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./pen/pen-tool.js')).PenRedTool
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-select',
    name: 'Select',
    icon: '⬚',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./select/select-tool.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-delete',
    name: 'Delete',
    icon: '⌫',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./delete/delete-tool.js')).default
    },
  },
  // -------------------------------------------------------------------------
  // Render layers (tag: spatial-canvas-layer)
  // Mounted into z-index:auto divs inside .sc-layer. Each layer
  // self-subscribes to handle changes and renders its own element types.
  // -------------------------------------------------------------------------
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-layer-rectangles',
    name: 'Rectangle Layer',
    icon: '□',
    tags: ['spatial-canvas-layer'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./rectangle/layer.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-layer-pen',
    name: 'Pen Layer',
    icon: '✒',
    tags: ['spatial-canvas-layer'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./pen/layer.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-layer-selection',
    name: 'Selection Layer',
    icon: '⬚',
    tags: ['spatial-canvas-layer'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./select/layer.js')).default
    },
  },
  // -------------------------------------------------------------------------
  // Embed tool + layer
  // -------------------------------------------------------------------------
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-embed',
    name: 'Embed',
    icon: '⊞',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./embed/place-tool.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-layer-embed',
    name: 'Embed Layer',
    icon: '⊞',
    tags: ['spatial-canvas-layer'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./embed/layer.js')).default
    },
  },
]
