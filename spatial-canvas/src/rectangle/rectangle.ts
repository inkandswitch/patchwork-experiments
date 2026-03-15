import type { Ref } from '@automerge/automerge-repo'
import type { CanvasShape, Disposer } from '../canvas/types.js'

// ============================================================================
// Shape type
// ============================================================================

export type RectangleFill = 'transparent' | 'white' | 'filled'

export interface RectangleShape extends CanvasShape {
  type: 'rectangle'
  width: number
  height: number
  color?: string
  fill?: RectangleFill  // default: 'filled'
}

// ============================================================================
// Data model
// ============================================================================

export interface RectangleDoc {
  color: string
}

// ============================================================================
// Datatype
// ============================================================================

export const RectangleDatatype = {
  init(doc: RectangleDoc) {
    doc.color = '#4f8ef7'
  },

  getTitle(_doc: RectangleDoc): string {
    return 'Rectangle'
  },

  markCopy(_doc: RectangleDoc) {},
}

// ============================================================================
// Tool — plain DOM, no framework
// ============================================================================

export function RectangleTool(ref: Ref<RectangleDoc>, element: HTMLElement): Disposer {
  const root = document.createElement('div')
  root.style.cssText = `
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border-radius: 4px;
    background: #4f8ef7;
    border: 2px solid #4f8ef7;
  `

  function render() {
    const doc = ref.value()
    if (!doc) return
    root.style.background = doc.color
    root.style.borderColor = doc.color
  }

  element.appendChild(root)
  render()

  const unsubscribe = ref.onChange(render)

  return () => {
    unsubscribe()
    root.remove()
  }
}

// ============================================================================
// Plugin exports
// ============================================================================

export const rectanglePlugins = [
  {
    type: 'patchwork:datatype' as const,
    id: 'rectangle',
    name: 'Rectangle',
    icon: 'Square',
    async load() {
      return RectangleDatatype
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'rectangle',
    name: 'Rectangle',
    icon: 'Square',
    supportedDatatypes: ['rectangle'],
    async load() {
      return RectangleTool
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'spatial-canvas-tool-place-rectangle',
    name: 'Rectangle',
    icon: 'Square',
    tags: ['spatial-canvas-tool'],
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./place-tool.js')).default
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: 'canvas-rectangle',
    name: 'Rectangle Shape',
    supportedDatatypes: ['spatial-canvas'],
    async load() {
      return (await import('./canvas-tool.js')).default
    },
  },
]
