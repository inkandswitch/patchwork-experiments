import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, Disposer } from './types.js'
import { getRegistry } from '@inkandswitch/patchwork-plugins'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'

/**
 * ToolbarPanel — renders one patchwork-view per spatial-canvas-tool plugin.
 *
 * Each view IS the button: it carries .sc-tool-btn for styling, receives native
 * click events, and is also the direct target for canvas pointer CustomEvents
 * (dispatched by canvas.ts via `patchwork-view[tool-id="..."]`).
 */
export default function ToolbarPanel(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
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

  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? 'local'

  function applyActiveTool(toolId: string | undefined) {
    for (const view of views) {
      view.classList.toggle('active', view.getAttribute('tool-id') === toolId)
    }
  }

  applyActiveTool(handle.doc()?.stateByUser?.[contactUrl]?.selectedTool)

  const onDocChange = ({ doc }: { doc: CanvasDoc }) => {
    applyActiveTool(doc.stateByUser?.[contactUrl]?.selectedTool)
  }
  handle.on('change', onDocChange)

  return () => {
    handle.off('change', onDocChange)
  }
}
