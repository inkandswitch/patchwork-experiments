import type { CanvasShape, Disposer } from './types.js'

/**
 * Mount a token shape — a bare <patchwork-view> with no chrome, no border,
 * no titlebar. Not resizable by the canvas (resize handles are suppressed).
 *
 * The patchwork-view fills the entire shape container.
 */
export function mountToken(container: HTMLElement, shape: CanvasShape): Disposer {
  const el = document.createElement('patchwork-view') as HTMLElement
  el.setAttribute('doc-url', shape.docUrl ?? '')
  if (shape.toolId) el.setAttribute('tool-id', shape.toolId)
  el.style.cssText = 'width: 100%; height: 100%; display: block; pointer-events: auto;'
  container.appendChild(el)
  return () => el.remove()
}
