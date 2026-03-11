import type { CanvasDoc, DocHandle, Disposer } from './types.js'
import { getRegistry } from '@inkandswitch/patchwork-plugins'

/**
 * ToolbarPanel — renders one patchwork-view per spatial-canvas-tool plugin.
 *
 * Each view IS the button: it carries .sc-tool-btn for styling, receives native
 * click events, and is also the direct target for canvas pointer CustomEvents
 * (dispatched by canvas.ts via `patchwork-view[tool-id="..."]`).
 */
export default function ToolbarPanel(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): Disposer {
  const registry = getRegistry('patchwork:tool')
  const toolDescs = registry.filter(
    p => !!((p.tags as string[] | undefined)?.includes('spatial-canvas-tool'))
  )

  element.style.cssText = 'display:flex;gap:4px;'

  const views: HTMLElement[] = []
  const container = element.closest('.sc-container')

  for (const desc of toolDescs) {
    const view = document.createElement('patchwork-view')
    view.setAttribute('doc-url', handle.url)
    view.setAttribute('tool-id', desc.id)
    view.className = 'sc-tool-btn'
    view.title = desc.name

    view.addEventListener('click', () => {
      container?.dispatchEvent(new CustomEvent('spatial-canvas:set-tool', {
        detail: { toolId: desc.id },
        bubbles: false,
      }))
    })

    element.appendChild(view)
    views.push(view)
  }

  const onToolChanged = (e: Event) => {
    const toolId = (e as CustomEvent<{ toolId: string }>).detail.toolId
    for (const view of views) {
      view.classList.toggle('active', view.getAttribute('tool-id') === toolId)
    }
  }

  container?.addEventListener('spatial-canvas:tool-changed', onToolChanged)

  return () => {
    container?.removeEventListener('spatial-canvas:tool-changed', onToolChanged)
  }
}
