import type { CanvasShape, Disposer } from './types.js'
import type { Repo } from '@automerge/automerge-repo'
import { resolveDocTitle } from '../shared/resolve-doc-title.js'

export interface ToolOption {
  id: string
  name: string
}

/**
 * Mount an embed shape — a framed card with a titlebar and a <patchwork-view>
 * content area.
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────┐
 *   │ [doc-name]              [tool ▾]    │  ← titlebar
 *   ├─────────────────────────────────────┤
 *   │                                     │
 *   │   <patchwork-view>                  │
 *   │                                     │
 *   └─────────────────────────────────────┘
 *
 * - The doc-name span is pointer-events: none so drag-to-move falls through
 *   to the canvas.
 * - The tool <select> is pointer-events: auto so the user can pick a tool
 *   without starting a canvas drag.
 * - The content area blocks pointer events from reaching the canvas while
 *   the embed is focused, matching tldraw's embedded-content isolation.
 *
 * @param container    - The .sc-shape-content div created by mountShape()
 * @param shape        - The CanvasShape data
 * @param onToolChange - Called with the new toolId when the user picks a tool
 * @param getTools     - Optional async supplier of available tools for the doc.
 *                       If omitted the <select> shows only the current toolId.
 */
export function mountEmbed(
  container: HTMLElement,
  shape: CanvasShape,
  onToolChange: (newToolId: string) => void,
  getTools?: (docUrl: string) => Promise<ToolOption[]>,
  repo?: Repo
): Disposer {
  let focused = false
  let stopPointerCleanup: (() => void) | null = null

  // -------------------------------------------------------------------------
  // Outer card
  // -------------------------------------------------------------------------
  const card = document.createElement('div')
  card.style.cssText = `
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    overflow: hidden;
    pointer-events: all;
  `

  // -------------------------------------------------------------------------
  // Titlebar
  // -------------------------------------------------------------------------
  const titlebar = document.createElement('div')
  titlebar.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
    cursor: grab;
    user-select: none;
    background: #fafafa;
    pointer-events: none;
  `

  // Doc name — passes drag events through (pointer-events: none inherited)
  const docName = document.createElement('span')
  docName.style.cssText = `
    font-size: 11px;
    font-family: system-ui, -apple-system, sans-serif;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  `
  if (shape.docUrl && repo) {
    docName.textContent = 'Loading…'
    repo.find<Record<string, unknown>>(shape.docUrl)
      .then(h => resolveDocTitle(h))
      .then(title => { docName.textContent = title })
      .catch(() => { docName.textContent = 'Untitled' })
  } else {
    docName.textContent = 'Untitled'
  }

  // Tool picker — <select> with pointer-events restored
  const select = document.createElement('select')
  select.style.cssText = `
    pointer-events: auto;
    font-size: 11px;
    font-family: system-ui, -apple-system, sans-serif;
    color: #374151;
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 1px 4px;
    cursor: pointer;
    flex-shrink: 0;
    max-width: 120px;
  `

  // Seed the select with the current toolId immediately, then refresh if
  // getTools resolves with a richer list
  function populateSelect(tools: ToolOption[], currentToolId: string) {
    select.innerHTML = ''
    const seen = new Set<string>()
    for (const t of tools) {
      seen.add(t.id)
      const opt = document.createElement('option')
      opt.value = t.id
      opt.textContent = t.name
      opt.selected = t.id === currentToolId
      select.appendChild(opt)
    }
    // Ensure the current toolId always appears even if missing from the list
    if (!seen.has(currentToolId)) {
      const opt = document.createElement('option')
      opt.value = currentToolId
      opt.textContent = currentToolId || '(default)'
      opt.selected = true
      select.appendChild(opt)
    }
  }

  populateSelect([], shape.toolId)

  if (getTools) {
    getTools(shape.docUrl).then(tools => populateSelect(tools, shape.toolId)).catch(() => {})
  }

  select.addEventListener('change', (e) => {
    e.stopPropagation()
    const newToolId = select.value
    if (newToolId !== shape.toolId) onToolChange(newToolId)
  })

  // Stop pointer events on the select from bubbling to the canvas drag handler
  select.addEventListener('pointerdown', (e) => e.stopPropagation())
  select.addEventListener('pointerup',   (e) => e.stopPropagation())

  titlebar.appendChild(docName)
  titlebar.appendChild(select)

  // -------------------------------------------------------------------------
  // Content area
  // -------------------------------------------------------------------------
  const content = document.createElement('div')
  content.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    pointer-events: auto;
    user-select: none;
  `

  // Click inside the content area focuses the embed — from that point on,
  // pointer / keyboard / wheel events are stopped so the canvas doesn't
  // interfere with the embedded tool
  function attachFocusListeners() {
    const stopKey = (e: KeyboardEvent) => e.stopPropagation()
    const stopWheel = (e: WheelEvent) => { if (!e.ctrlKey) e.stopPropagation() }
    const stopPointer = (e: PointerEvent) => e.stopPropagation()

    content.addEventListener('keydown',     stopKey)
    content.addEventListener('keyup',       stopKey)
    content.addEventListener('keypress',    stopKey)
    content.addEventListener('wheel',       stopWheel as EventListener)
    content.addEventListener('pointerdown', stopPointer, true)
    content.addEventListener('pointermove', stopPointer, true)
    content.addEventListener('pointerup',   stopPointer, true)

    return () => {
      content.removeEventListener('keydown',     stopKey)
      content.removeEventListener('keyup',       stopKey)
      content.removeEventListener('keypress',    stopKey)
      content.removeEventListener('wheel',       stopWheel as EventListener)
      content.removeEventListener('pointerdown', stopPointer, true)
      content.removeEventListener('pointermove', stopPointer, true)
      content.removeEventListener('pointerup',   stopPointer, true)
    }
  }

  content.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    if (!focused) {
      focused = true
      content.style.userSelect = 'text'
      stopPointerCleanup = attachFocusListeners()
      // Synthesize a click for frameworks that use document-level delegation
      ;(e.target as HTMLElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY })
      )
    }
  })

  // Clicking outside the card unfocuses the embed
  const onOutsidePointerDown = (e: PointerEvent) => {
    if (!focused) return
    if (!card.contains(e.target as Node)) {
      focused = false
      content.style.userSelect = 'none'
      stopPointerCleanup?.()
      stopPointerCleanup = null
    }
  }
  window.addEventListener('pointerdown', onOutsidePointerDown, true)

  // Mount patchwork-view inside content
  const pw = document.createElement('patchwork-view') as HTMLElement
  pw.setAttribute('doc-url', shape.docUrl)
  if (shape.toolId) pw.setAttribute('tool-id', shape.toolId)
  pw.style.cssText = 'display: block; width: 100%; height: 100%;'
  content.appendChild(pw)

  card.appendChild(titlebar)
  card.appendChild(content)
  container.appendChild(card)

  return () => {
    stopPointerCleanup?.()
    window.removeEventListener('pointerdown', onOutsidePointerDown, true)
    card.remove()
  }
}
