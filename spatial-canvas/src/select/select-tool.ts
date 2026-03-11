import type { CanvasDoc, DocHandle, Disposer } from '../core/types.js'
import { translateShapes, nextZIndex } from '../core/commands.js'

/** Maximum screen-space gap (px) between hit-test samples during line-draw sweep. */
const MAX_HIT_GAP = 4

/** Radial hit-test probe configuration for pointer-down. */
const PROBE_POINTS = 10
const PROBE_RADIUS = 5

// ============================================================================
// Types
// ============================================================================

type Vec2 = { x: number; y: number }

interface PointerDetail {
  canvasX: number
  canvasY: number
  screenX: number
  screenY: number
}

// ============================================================================
// Hit detection
// ============================================================================

function shapeIdAt(screenX: number, screenY: number): string | null {
  for (const el of document.elementsFromPoint(screenX, screenY)) {
    let node: Element | null = el
    while (node) {
      const id = (node as HTMLElement).dataset?.shapeId
      if (id) return id
      node = node.parentElement
    }
  }
  return null
}

/**
 * Check the center point plus `points` evenly-spaced probes on a circle of
 * `radius` px around (screenX, screenY). Returns the first shape id found.
 */
function shapeIdNear(
  screenX: number,
  screenY: number,
  points = PROBE_POINTS,
  radius = PROBE_RADIUS,
): string | null {
  const hit = shapeIdAt(screenX, screenY)
  if (hit) return hit
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points
    const id = shapeIdAt(screenX + Math.cos(angle) * radius, screenY + Math.sin(angle) * radius)
    if (id) return id
  }
  return null
}

// ============================================================================
// Button indicator — dashed selection rectangle
// ============================================================================

function mountSelectButton(btn: HTMLElement): () => void {
  const prev = btn.innerHTML
  // Lucide MousePointer2
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>`
  return () => { btn.innerHTML = prev }
}

// ============================================================================
// Helpers
// ============================================================================

function ensureUserState(d: CanvasDoc, contactUrl: string) {
  if (!d.stateByUser) d.stateByUser = {}
  if (!d.stateByUser[contactUrl]) {
    d.stateByUser[contactUrl] = { selection: {}, color: '#1a1a1a' }
  }
  if (!d.stateByUser[contactUrl].selection) {
    d.stateByUser[contactUrl].selection = {}
  }
}

// ============================================================================
// Tool
// ============================================================================

export default function SelectTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: HTMLElement
): Disposer {
  const removeIndicator = mountSelectButton(buttonEl)

  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'

  // --- Mode ---
  type Mode = 'idle' | 'line' | 'drag'
  let mode: Mode = 'idle'

  // --- Line-draw state ---
  let lineSvg: SVGSVGElement | null = null
  let linePolyline: SVGPolylineElement | null = null
  let linePoints: [number, number][] = []
  let prevScreen: Vec2 | null = null
  let prevCanvas: Vec2 | null = null

  // --- Drag state ---
  let dragStartCanvas: Vec2 | null = null
  let dragOrigins: Map<string, Vec2> = new Map()

  // ---- selection helpers ----

  function getMyIds(): string[] {
    return Object.keys(handle.doc()?.stateByUser?.[contactUrl]?.selection ?? {})
  }

  function isSelected(id: string): boolean {
    return handle.doc()?.stateByUser?.[contactUrl]?.selection?.[id] === true
  }

  function clearSelection() {
    handle.change(d => {
      ensureUserState(d, contactUrl)
      d.stateByUser[contactUrl].selection = {}
    })
  }

  function addToSelectionBatch(ids: string[]) {
    if (ids.length === 0) return
    handle.change(d => {
      ensureUserState(d, contactUrl)
      for (const id of ids) {
        d.stateByUser[contactUrl].selection[id] = true
      }
    })
  }

  // ---- layer helper ----

  function getLayer(): HTMLElement | null {
    return buttonEl.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
  }

  // ---- line drawing ----

  function startLine(canvasX: number, canvasY: number, layer: HTMLElement) {
    lineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    lineSvg.style.cssText = 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none;'

    linePolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    linePolyline.setAttribute('stroke', '#1a73e8')
    linePolyline.setAttribute('stroke-width', '3')
    linePolyline.setAttribute('stroke-linecap', 'round')
    linePolyline.setAttribute('stroke-linejoin', 'round')
    linePolyline.setAttribute('fill', 'none')
    linePolyline.setAttribute('opacity', '0.45')
    lineSvg.appendChild(linePolyline)

    // Insert as first child so it renders below all shapes
    layer.insertBefore(lineSvg, layer.firstChild)

    linePoints = [[canvasX, canvasY]]
    linePolyline.setAttribute('points', `${canvasX},${canvasY}`)
  }

  function extendLine(canvasX: number, canvasY: number) {
    if (!linePolyline) return
    linePoints.push([canvasX, canvasY])
    linePolyline.setAttribute('points', linePoints.map(p => p.join(',')).join(' '))
  }

  function removeLine() {
    lineSvg?.remove()
    lineSvg = null
    linePolyline = null
    linePoints = []
  }

  // ---- sweep interpolation ----

  function sweep(
    fromScreen: Vec2, toScreen: Vec2,
    fromCanvas: Vec2, toCanvas: Vec2
  ) {
    const dx = toScreen.x - fromScreen.x
    const dy = toScreen.y - fromScreen.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const steps = Math.max(1, Math.ceil(dist / MAX_HIT_GAP))

    const newIds: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const sx = fromScreen.x + dx * t
      const sy = fromScreen.y + dy * t
      const cx = fromCanvas.x + (toCanvas.x - fromCanvas.x) * t
      const cy = fromCanvas.y + (toCanvas.y - fromCanvas.y) * t
      extendLine(cx, cy)
      const id = shapeIdAt(sx, sy)
      if (id && !isSelected(id) && !newIds.includes(id)) newIds.push(id)
    }
    addToSelectionBatch(newIds)
  }

  // ---- event handlers ----

  function onPointerDown(e: Event) {
    const { canvasX, canvasY, screenX, screenY } = (e as CustomEvent<PointerDetail>).detail
    const hitId = shapeIdNear(screenX, screenY)

    if (hitId) {
      if (!isSelected(hitId)) {
        // Not part of current selection — clear and select just this shape
        clearSelection()
        addToSelectionBatch([hitId])
      }
      // Start drag for entire selection — bump zIndex above everything else,
      // preserving the relative stacking order of the dragged shapes.
      mode = 'drag'
      dragStartCanvas = { x: canvasX, y: canvasY }
      const doc = handle.doc()
      const ids = getMyIds().filter(id => doc?.shapes[id])
      dragOrigins = new Map(ids.map(id => [id, { x: doc!.shapes[id].x, y: doc!.shapes[id].y }]))
      handle.change(d => {
        const base = nextZIndex(d)
        const sorted = [...ids].sort((a, b) => d.shapes[a].zIndex - d.shapes[b].zIndex)
        sorted.forEach((id, i) => { d.shapes[id].zIndex = base + i })
      })
    } else {
      // Pointer down on empty space — start line-draw selection
      clearSelection()
      mode = 'line'
      const layer = getLayer()
      if (layer) startLine(canvasX, canvasY, layer)
      prevScreen = { x: screenX, y: screenY }
      prevCanvas = { x: canvasX, y: canvasY }
    }
  }

  function onPointerMove(e: Event) {
    const { canvasX, canvasY, screenX, screenY } = (e as CustomEvent<PointerDetail>).detail

    if (mode === 'drag' && dragStartCanvas) {
      const delta = {
        x: canvasX - dragStartCanvas.x,
        y: canvasY - dragStartCanvas.y,
      }
      const moves = new Map(
        [...dragOrigins].map(([id, o]) => [id, { x: o.x + delta.x, y: o.y + delta.y }])
      )
      translateShapes(handle, moves)
    } else if (mode === 'line') {
      const from = prevScreen ?? { x: screenX, y: screenY }
      const fromC = prevCanvas ?? { x: canvasX, y: canvasY }
      sweep(from, { x: screenX, y: screenY }, fromC, { x: canvasX, y: canvasY })
      prevScreen = { x: screenX, y: screenY }
      prevCanvas = { x: canvasX, y: canvasY }
    }
  }

  function onPointerUp() {
    if (mode === 'line') removeLine()
    mode = 'idle'
    dragStartCanvas = null
    dragOrigins.clear()
    prevScreen = null
    prevCanvas = null
  }

  function onCancel() {
    if (mode === 'line') removeLine()
    mode = 'idle'
    dragStartCanvas = null
    dragOrigins.clear()
    prevScreen = null
    prevCanvas = null
  }

  buttonEl.addEventListener('spatial-canvas:pointerdown', onPointerDown)
  buttonEl.addEventListener('spatial-canvas:pointermove', onPointerMove)
  buttonEl.addEventListener('spatial-canvas:pointerup',   onPointerUp)
  buttonEl.addEventListener('spatial-canvas:cancel',      onCancel)

  return () => {
    buttonEl.removeEventListener('spatial-canvas:pointerdown', onPointerDown)
    buttonEl.removeEventListener('spatial-canvas:pointermove', onPointerMove)
    buttonEl.removeEventListener('spatial-canvas:pointerup',   onPointerUp)
    buttonEl.removeEventListener('spatial-canvas:cancel',      onCancel)
    handle.change(d => {
      if (d.stateByUser?.[contactUrl]) {
        d.stateByUser[contactUrl].selection = {}
      }
    })
    removeLine()
    removeIndicator()
  }
}
