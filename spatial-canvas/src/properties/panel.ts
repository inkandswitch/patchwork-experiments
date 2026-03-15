import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, Disposer } from '../canvas/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import type { RectangleFill } from '../rectangle/rectangle.js'
import type { TextShape } from '../text/text.js'

const COLORS = [
  '#1a1a1a', '#9ca3af', '#c084fc', '#7c3aed',
  '#3b82f6', '#60a5fa', '#f59e0b', '#f97316',
  '#15803d', '#4ade80', '#fb7185', '#ef4444',
]

const DEFAULT_COLOR = COLORS[0]
const DEFAULT_FILL: RectangleFill = 'filled'

// ============================================================================
// Fill mode icons — two overlapping rounded rectangles
// ============================================================================

function fillIcon(mode: RectangleFill): string {
  // back rect: top-right; front rect: bottom-left — same as screenshot style
  const back = `<rect x="5" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" fill="white"/>`
  let frontFill: string
  if (mode === 'transparent') {
    frontFill = 'fill="none"'
  } else if (mode === 'white') {
    frontFill = 'fill="white"'
  } else {
    frontFill = 'fill="currentColor" fill-opacity="0.25"'
  }
  const front = `<rect x="2" y="5" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" ${frontFill}/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" pointer-events="none">${back}${front}</svg>`
}

/**
 * PropertiesPanel — fixed color-swatch picker + fill mode selector.
 * Reads/writes doc.stateByUser[contactUrl].color and .fill.
 * Applies both to all currently selected shapes that support them.
 */
export default function PropertiesPanel(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'

  element.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:6px;'

  // ---- Color swatches ----
  const swatchGrid = document.createElement('div')
  swatchGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,28px);gap:4px;'
  element.appendChild(swatchGrid)

  const swatches = new Map<string, HTMLButtonElement>()

  function getCurrentColor(): string {
    return handle.doc()?.stateByUser?.[contactUrl]?.color ?? DEFAULT_COLOR
  }

  function setColorActive(color: string) {
    for (const [c, btn] of swatches) {
      const wrap = btn.parentElement!
      wrap.style.background = c === color ? '#e8e8e8' : 'transparent'
    }
  }

  function applyColor(newColor: string) {
    handle.change(d => {
      if (!d.stateByUser) d.stateByUser = {}
      if (!d.stateByUser[contactUrl]) {
        d.stateByUser[contactUrl] = { selection: {}, color: newColor }
      } else {
        d.stateByUser[contactUrl].color = newColor
      }
      const selection = d.stateByUser[contactUrl].selection ?? {}
      for (const shapeId of Object.keys(selection)) {
        const shape = d.shapes[shapeId]
        if (shape && 'color' in shape) (shape as any).color = newColor
      }
    })
  }

  for (const color of COLORS) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:5px;transition:background 0.1s;'
    const btn = document.createElement('button')
    btn.style.cssText = `width:20px;height:20px;border-radius:50%;background:${color};border:none;cursor:pointer;padding:0;transition:transform 0.1s;`
    btn.title = color
    btn.addEventListener('click', () => applyColor(color))
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.15)' })
    btn.addEventListener('mouseleave', () => { btn.style.transform = '' })
    swatches.set(color, btn)
    wrap.appendChild(btn)
    swatchGrid.appendChild(wrap)
  }

  // ---- Divider ----
  const divider = document.createElement('div')
  divider.style.cssText = 'height:1px;background:#e0e0e0;margin:0 -2px;'
  element.appendChild(divider)

  // ---- Fill mode buttons ----
  const fillRow = document.createElement('div')
  fillRow.style.cssText = 'display:flex;gap:4px;justify-content:center;'
  element.appendChild(fillRow)

  const FILL_MODES: RectangleFill[] = ['transparent', 'white', 'filled']
  const FILL_LABELS: Record<RectangleFill, string> = {
    transparent: 'No fill',
    white: 'White fill',
    filled: 'Color fill',
  }
  const fillBtns = new Map<RectangleFill, HTMLButtonElement>()

  function getCurrentFill(): RectangleFill {
    return (handle.doc()?.stateByUser?.[contactUrl]?.fill as RectangleFill | undefined)
      ?? DEFAULT_FILL
  }

  function setFillActive(fill: RectangleFill) {
    for (const [mode, btn] of fillBtns) {
      btn.style.background = mode === fill ? '#e8e8e8' : 'transparent'
      btn.style.outline = 'none'
    }
  }

  function applyFill(newFill: RectangleFill) {
    handle.change(d => {
      if (!d.stateByUser) d.stateByUser = {}
      if (!d.stateByUser[contactUrl]) {
        d.stateByUser[contactUrl] = { selection: {}, color: DEFAULT_COLOR, fill: newFill }
      } else {
        d.stateByUser[contactUrl].fill = newFill
      }
      // Apply to all currently selected shapes that have a fill field
      const selection = d.stateByUser[contactUrl].selection ?? {}
      for (const shapeId of Object.keys(selection)) {
        const shape = d.shapes[shapeId]
        if (shape?.type === 'rectangle') (shape as any).fill = newFill
      }
    })
  }

  for (const mode of FILL_MODES) {
    const btn = document.createElement('button')
    btn.style.cssText = 'width:32px;height:32px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:5px;transition:background 0.1s;'
    btn.title = FILL_LABELS[mode]
    btn.innerHTML = fillIcon(mode)
    btn.addEventListener('click', () => applyFill(mode))
    fillBtns.set(mode, btn)
    fillRow.appendChild(btn)
  }

  // ---- Divider ----
  const divider2 = document.createElement('div')
  divider2.style.cssText = 'height:1px;background:#e0e0e0;margin:0 -2px;'
  element.appendChild(divider2)

  // ---- Font size row ----
  const fontSizeRow = document.createElement('div')
  fontSizeRow.style.cssText = 'display:flex;gap:4px;justify-content:center;'
  element.appendChild(fontSizeRow)

  const FONT_SIZES: { label: string; value: number }[] = [
    { label: 'S',  value: 14 },
    { label: 'M',  value: 18 },
    { label: 'L',  value: 24 },
    { label: 'XL', value: 36 },
  ]
  const fontSizeBtns = new Map<number, HTMLButtonElement>()

  function getCurrentFontSize(): number {
    return handle.doc()?.stateByUser?.[contactUrl]?.fontSize ?? 18
  }

  function setFontSizeActive(size: number) {
    for (const [v, btn] of fontSizeBtns) {
      btn.style.background = v === size ? '#e8e8e8' : 'transparent'
    }
  }

  function applyFontSize(newSize: number) {
    handle.change(d => {
      if (!d.stateByUser) d.stateByUser = {}
      if (!d.stateByUser[contactUrl]) {
        d.stateByUser[contactUrl] = { selection: {}, color: DEFAULT_COLOR, fontSize: newSize }
      } else {
        d.stateByUser[contactUrl].fontSize = newSize
      }
      const selection = d.stateByUser[contactUrl].selection ?? {}
      for (const shapeId of Object.keys(selection)) {
        const shape = d.shapes[shapeId]
        if (shape?.type === 'text') (shape as unknown as TextShape).fontSize = newSize
      }
    })
  }

  for (const { label, value } of FONT_SIZES) {
    const btn = document.createElement('button')
    btn.style.cssText = 'width:32px;height:32px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;border-radius:5px;transition:background 0.1s;font:13px/1 system-ui,sans-serif;font-weight:500;color:#444;'
    btn.textContent = label
    btn.title = `Font size ${value}px`
    btn.addEventListener('click', () => applyFontSize(value))
    fontSizeBtns.set(value, btn)
    fontSizeRow.appendChild(btn)
  }

  // ---- Sync on doc change ----
  function onDocChange() {
    setColorActive(getCurrentColor())
    setFillActive(getCurrentFill())
    setFontSizeActive(getCurrentFontSize())
  }

  handle.on('change', onDocChange)
  onDocChange()

  return () => {
    handle.off('change', onDocChange)
    element.innerHTML = ''
  }
}
