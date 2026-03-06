import type { AutomergeUrl, CanvasShape, Disposer } from './types.js'
import type { Repo } from '@automerge/automerge-repo'
import { createDocOfDatatype2, getRegistry } from '@inkandswitch/patchwork-plugins'
import type { LoadedDatatypePlugin } from '@inkandswitch/patchwork-plugins'
import { PwDocToken } from '../doc-token/pw-doc-token.js'

// ---------------------------------------------------------------------------
// Tool-registry helpers
// ---------------------------------------------------------------------------

type ToolPlugin = {
  id: string
  name: string
  supportedDatatypes: '*' | string[]
  unlisted?: boolean
  forTitleBar?: boolean
  module?: unknown
}

export function getToolsForType(datatypeId: string): ToolPlugin[] {
  return (getRegistry('patchwork:tool').all() as ToolPlugin[]).filter(t =>
    !t.unlisted &&
    !t.forTitleBar &&
    (t.supportedDatatypes === '*' ||
      (Array.isArray(t.supportedDatatypes) && t.supportedDatatypes.includes(datatypeId)))
  )
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
  onDelete: () => void,
  repo?: Repo
): Disposer {
  // -------------------------------------------------------------------------
  // Empty state — no docUrl yet: show "Create new" type picker
  // -------------------------------------------------------------------------
  if (!shape.docUrl) {
    return mountTypePicker(container, onDocCreate, onDelete, repo)
  }

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
    border: 1px solid var(--pw-border, #ddd5c4);
    border-radius: 6px;
    background: #ffffff;
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
    padding: 0 6px;
    border-bottom: 1px solid var(--pw-border, #ddd5c4);
    flex-shrink: 0;
    cursor: grab;
    user-select: none;
    background: var(--pw-header-bg, #ede7db);
    pointer-events: none;
    gap: 4px;
  `

  // Doc name — pw-doc-token pill (draggable, resolves title automatically)
  const docName = document.createElement('pw-doc-token') as PwDocToken
  docName.style.cssText = `
    flex: 0 1 auto;
    min-width: 0;
    max-width: 60%;
    pointer-events: auto;
  `
  if (shape.docUrl) {
    docName.setAttribute('doc-url', shape.docUrl)
  }
  if (repo) {
    docName.repo = repo
  }
  docName.addEventListener('pointerdown', (e) => e.stopPropagation())
  docName.addEventListener('pointerup',   (e) => e.stopPropagation())

  // Tool picker — borderless select, styled like ll-model
  const select = document.createElement('select')
  select.style.cssText = `
    pointer-events: auto;
    flex-shrink: 0;
    margin-left: auto;
    appearance: none;
    -webkit-appearance: none;
    font-size: 11px;
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--pw-text-label, #a89880);
    background: var(--pw-surface, #ede8de);
    border: none;
    border-radius: 4px;
    padding: 2px 18px 2px 6px;
    cursor: pointer;
    outline: none;
    max-width: 120px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238a7f72' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 2px center;
  `

  function populateSelect(tools: ToolPlugin[], currentToolId: string) {
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
    // Ensure the current toolId always appears even if not yet loaded in the registry
    if (currentToolId && !seen.has(currentToolId)) {
      const opt = document.createElement('option')
      opt.value = currentToolId
      opt.textContent = currentToolId
      opt.selected = true
      select.appendChild(opt)
    }
  }

  // Seed immediately with just the current toolId; registry fill happens below
  populateSelect([], shape.toolId ?? '')

  let unsubscribeRegistry: (() => void) | null = null

  // Resolve the document's datatype, then wire up live registry queries
  if (repo && shape.docUrl) {
    repo.find<Record<string, unknown>>(shape.docUrl).then(async handle => {
      await handle.whenReady()
      const doc = handle.doc()
      const patchwork = doc?.['@patchwork'] as { type?: string } | undefined
      const datatypeId = patchwork?.type ?? ''

      const refresh = () => populateSelect(getToolsForType(datatypeId), shape.toolId ?? '')
      refresh()
      unsubscribeRegistry = getRegistry('patchwork:tool').on('changed', refresh)
    }).catch(() => {})
  }

  select.addEventListener('change', (e) => {
    e.stopPropagation()
    const newToolId = select.value
    if (newToolId !== shape.toolId) onToolChange(newToolId)
  })

  // Stop pointer events on the select from bubbling to the canvas drag handler
  select.addEventListener('pointerdown', (e) => e.stopPropagation())
  select.addEventListener('pointerup',   (e) => e.stopPropagation())

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.style.cssText = `
    pointer-events: auto;
    flex-shrink: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    color: var(--pw-text-label, #a89880);
    padding: 0 4px;
    line-height: 1;
  `
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete() })
  closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
  closeBtn.addEventListener('pointerup', (e) => e.stopPropagation())

  titlebar.appendChild(docName)
  titlebar.appendChild(select)
  titlebar.appendChild(closeBtn)

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
    user-select: text;
  `

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
    unsubscribeRegistry?.()
    card.remove()
  }
}

// ============================================================================
// Type picker — shown when a shape has no docUrl yet
// ============================================================================

function mountTypePicker(
  container: HTMLElement,
  onDocCreate: (newDocUrl: AutomergeUrl) => void,
  onDelete: () => void,
  repo?: Repo
): Disposer {
  const card = document.createElement('div')
  card.style.cssText = `
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1.5px dashed #9ca3af;
    border-radius: 4px;
    background: #f3f4f6;
    overflow: hidden;
    pointer-events: all;
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    position: relative;
  `

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    color: #9ca3af;
    padding: 0 4px;
    line-height: 1;
  `
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete() })
  closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
  closeBtn.addEventListener('pointerup', (e) => e.stopPropagation())
  card.appendChild(closeBtn)

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
