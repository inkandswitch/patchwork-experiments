import type { Disposer } from './types.js'

// ============================================================================
// Data model
// ============================================================================

export interface RectangleDoc {
  color: string
}

interface RectangleDocHandle {
  doc(): RectangleDoc | undefined
  on(event: 'change', cb: (p: { doc: RectangleDoc }) => void): void
  off(event: 'change', cb: (p: { doc: RectangleDoc }) => void): void
  change(fn: (doc: RectangleDoc) => void): void
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

export function RectangleTool(handle: RectangleDocHandle, element: HTMLElement): Disposer {
  const root = document.createElement('div')
  root.style.cssText = `
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border-radius: 4px;
    background: #4f8ef7;
    border: 2px solid #4f8ef7;
  `

  element.appendChild(root)

  const onChange = () => {}
  handle.on('change', onChange)

  return () => {
    handle.off('change', onChange)
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
]
