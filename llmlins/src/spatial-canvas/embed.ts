import type { AutomergeUrl, CanvasShape, Disposer } from './types.js'
import type { Repo } from '@automerge/automerge-repo'
import { createDocOfDatatype2, getRegistry } from '@inkandswitch/patchwork-plugins'
import type { LoadedDatatypePlugin } from '@inkandswitch/patchwork-plugins'
import { resolveDocTitle } from '../shared/resolve-doc-title.js'

export interface ToolOption {
  id: string
  name: string
}

/**
 * Mount an embed shape.
 *
 * When shape.docUrl is set:
 *   ┌─────────────────────────────────────┐
 *   │ [doc-name]              [tool ▾]    │  ← titlebar
 *   ├─────────────────────────────────────┤
 *   │   <patchwork-view>                  │
 *   └─────────────────────────────────────┘
 *
 * When shape.docUrl is not set (newly placed empty shape):
 *   ┌─────────────────────────────────────┐
 *   │  Create new                         │
 *   │  · Essay                            │
 *   │  · Spatial Canvas  …               │
 *   └─────────────────────────────────────┘
 *   Clicking a type calls createDocOfDatatype2 then onDocCreate(url),
 *   which updates the shape in Automerge and triggers a re-mount.
 */
export function mountEmbed(
  container: HTMLElement,
  shape: CanvasShape,
  onToolChange: (newToolId: string) => void,
  onDocCreate: (newDocUrl: AutomergeUrl) => void,
  getTools?: (docUrl: string) => Promise<ToolOption[]>,
  repo?: Repo
): Disposer {
  // -------------------------------------------------------------------------
  // Empty state — no docUrl yet: show "Create new" type picker
  // -------------------------------------------------------------------------
  if (!shape.docUrl) {
    return mountTypePicker(container, onDocCreate, repo)
  }

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

  populateSelect([], shape.toolId ?? '')

  if (getTools && shape.docUrl) {
    getTools(shape.docUrl).then(tools => populateSelect(tools, shape.toolId ?? '')).catch(() => {})
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
  pw.setAttribute('doc-url', shape.docUrl ?? '')
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

// ============================================================================
// Type picker — shown when a shape has no docUrl yet
// ============================================================================

function mountTypePicker(
  container: HTMLElement,
  onDocCreate: (newDocUrl: AutomergeUrl) => void,
  repo?: Repo
): Disposer {
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
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
  `

  const heading = document.createElement('div')
  heading.textContent = 'Create new'
  heading.style.cssText = `
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
    flex-shrink: 0;
    user-select: none;
    cursor: grab;
    pointer-events: none;
  `
  card.appendChild(heading)

  const list = document.createElement('div')
  list.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    flex: 1;
  `
  card.appendChild(list)
  container.appendChild(card)

  let creating = false

  function renderList() {
    list.innerHTML = ''
    const registry = getRegistry('patchwork:datatype')
    const datatypes = (registry.all() as LoadedDatatypePlugin[]).filter(p => !(p as LoadedDatatypePlugin & { unlisted?: boolean }).unlisted)

    if (datatypes.length === 0) {
      const empty = document.createElement('div')
      empty.textContent = 'No document types available'
      empty.style.cssText = 'font-size: 12px; color: #9ca3af; padding: 4px 0;'
      list.appendChild(empty)
      return
    }

    for (const plugin of datatypes) {
      const btn = document.createElement('button')
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        text-align: left;
        font-size: 13px;
        font-family: inherit;
        color: #111827;
        transition: background 0.1s;
      `
      btn.addEventListener('mouseenter', () => { btn.style.background = '#f3f4f6' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent' })

      const name = document.createElement('span')
      name.textContent = plugin.name
      btn.appendChild(name)

      btn.addEventListener('click', async () => {
        if (creating || !repo) return
        creating = true
        btn.style.opacity = '0.5'
        try {
          const loaded = await registry.load(plugin.id) as LoadedDatatypePlugin | null
          if (!loaded) return
          const handle = await createDocOfDatatype2(loaded, repo)
          onDocCreate(handle.url)
        } catch (err) {
          console.error('[spatial-canvas] failed to create doc:', err)
          creating = false
          btn.style.opacity = '1'
        }
      })

      list.appendChild(btn)
    }
  }

  renderList()
  const unsubscribe = getRegistry('patchwork:datatype').on('changed', renderList)

  return () => {
    unsubscribe()
    card.remove()
  }
}
