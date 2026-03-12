import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'
import {
  getRegistry,
  createDocOfDatatype2,
  type DatatypeDescription,
  type LoadedDatatype,
} from '@inkandswitch/patchwork-plugins'
import { createShape, patchShape, newId, nextZIndex } from '../core/commands.js'
import { createElement, Link, type IconNode } from 'lucide'
import * as icons from 'lucide'
import type { EmbedShape } from './types.js'

interface PointerDetail {
  canvasX: number
  canvasY: number
  screenX: number
  screenY: number
}

function openDatatypeMenu(
  anchorEl: HTMLElement,
  onSelect: (id: string) => void,
): () => void {
  const registry = getRegistry<DatatypeDescription>('patchwork:datatype')
  const datatypes = registry.filter(d => !d.unlisted)

  const menu = document.createElement('div')
  menu.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'background:#fff',
    'border:1px solid #ddd',
    'border-radius:8px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.15)',
    'padding:4px',
    'min-width:160px',
    'font:13px/1.4 system-ui,sans-serif',
  ].join(';')

  for (const dt of datatypes) {
    const item = document.createElement('button')
    item.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'width:100%',
      'padding:6px 10px',
      'border:none',
      'background:none',
      'border-radius:5px',
      'cursor:pointer',
      'text-align:left',
      'font:inherit',
    ].join(';')
    const iconData = dt.icon ? (icons as unknown as Record<string, IconNode | undefined>)[dt.icon] : undefined
    if (iconData) item.appendChild(createElement(iconData, { width: 16, height: 16, style: 'pointer-events:none;flex-shrink:0' }))
    const label = document.createElement('span')
    label.textContent = dt.name
    item.appendChild(label)
    item.addEventListener('pointerdown', e => {
      e.stopPropagation()
      onSelect(dt.id)
      close()
    })
    item.addEventListener('mouseover', () => { item.style.background = '#f0f0f0' })
    item.addEventListener('mouseout', () => { item.style.background = '' })
    menu.appendChild(item)
  }

  // Position below the anchor button
  // Append hidden to measure height, then position above the anchor
  menu.style.visibility = 'hidden'
  document.body.appendChild(menu)
  const rect = anchorEl.getBoundingClientRect()
  const menuH = menu.offsetHeight
  menu.style.left = `${rect.left}px`
  menu.style.top = `${rect.top - menuH - 4}px`
  menu.style.visibility = ''

  function close() {
    menu.remove()
    document.removeEventListener('pointerdown', onOutside)
  }

  function onOutside(e: PointerEvent) {
    if (!menu.contains(e.target as Node)) close()
  }
  // Delay so the click that opened the menu doesn't immediately close it
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0)

  return close
}

// ============================================================================
// Tool
// ============================================================================

export default function PlaceEmbedTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: HTMLElement,
): Disposer {
  const repo = (buttonEl as any).repo
  const icon = createElement(Link, { width: 22, height: 22, style: 'pointer-events:none' })
  buttonEl.appendChild(icon)
  buttonEl.title = 'Embed'

  let pendingDatatypeId: string | null = null
  let closeMenu: (() => void) | null = null

  let origin: { x: number; y: number } | null = null
  let preview: HTMLElement | null = null

  // ---- helpers ----

  function getLayer(): HTMLElement | null {
    return buttonEl.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
  }

  function cleanup() {
    preview?.remove()
    preview = null
    origin = null
  }

  function updatePreview(ox: number, oy: number, cx: number, cy: number) {
    if (!preview) return
    const x = Math.min(ox, cx)
    const y = Math.min(oy, cy)
    const w = Math.abs(cx - ox)
    const h = Math.abs(cy - oy)
    preview.style.transform = `translate(${x}px,${y}px)`
    preview.style.width = `${w}px`
    preview.style.height = `${h}px`
  }

  // ---- button click → always open menu ----

  function onButtonClick() {
    closeMenu?.()
    closeMenu = openDatatypeMenu(buttonEl, id => {
      pendingDatatypeId = id
      closeMenu = null
    })
  }

  buttonEl.addEventListener('click', onButtonClick)

  // ---- canvas pointer events ----

  function onPointerDown(e: Event) {
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    origin = { x: canvasX, y: canvasY }

    preview = document.createElement('div')
    preview.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'box-sizing:border-box',
      'pointer-events:none',
      'background:rgba(100,100,200,0.08)',
      'border:1.5px dashed #6464c8',
      'border-radius:6px',
    ].join(';')
    updatePreview(canvasX, canvasY, canvasX, canvasY)
    getLayer()?.appendChild(preview)
  }

  function onPointerMove(e: Event) {
    if (!origin) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    updatePreview(origin.x, origin.y, canvasX, canvasY)
  }

  function onPointerUp(e: Event) {
    if (!origin) return
    const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
    const x = Math.min(origin.x, canvasX)
    const y = Math.min(origin.y, canvasY)
    const width  = Math.abs(canvasX - origin.x)
    const height = Math.abs(canvasY - origin.y)
    cleanup()

    if (width <= 4 || height <= 4 || !pendingDatatypeId) return

    const datatypeId = pendingDatatypeId
    const doc = handle.doc()
    const zIndex = doc ? nextZIndex(doc) : 0
    const id = newId()

    const placeholder: EmbedShape = {
      id,
      type: 'embed',
      x,
      y,
      zIndex,
      docUrl: '',
      docType: datatypeId,
      toolId: '',
      width,
      height,
    }
    createShape(handle, placeholder)

    // Async: create the real doc then patch the shape
    ;(async () => {
      try {
        const loaded = await getRegistry<DatatypeDescription>('patchwork:datatype').load(datatypeId)
        if (!loaded) return
        const docHandle = await createDocOfDatatype2(loaded as LoadedDatatype, repo)
        patchShape(handle, id, { docUrl: docHandle.url })
      } catch (err) {
        console.error('[PlaceEmbedTool] failed to create doc', err)
      }
    })()
  }

  function onCancel() {
    cleanup()
  }

  buttonEl.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  buttonEl.addEventListener('spatial-canvas:pointermove', onPointerMove)
  buttonEl.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  buttonEl.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    buttonEl.removeEventListener('click', onButtonClick)
    buttonEl.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    buttonEl.removeEventListener('spatial-canvas:pointermove', onPointerMove)
    buttonEl.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    buttonEl.removeEventListener('spatial-canvas:cancel',      onCancel)
    closeMenu?.()
    cleanup()
    icon.remove()
  }
}
