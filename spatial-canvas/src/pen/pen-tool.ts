import { getStroke } from 'perfect-freehand'
import type { CanvasDoc, CanvasShape, DocHandle, Disposer } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'

// ============================================================================
// Shape type
// ============================================================================

export interface PenShape extends CanvasShape {
  type: 'pen'
  points: [number, number, number][]  // [x, y, pressure] in canvas-space
  color: string
}

// ============================================================================
// SVG helpers
// ============================================================================

const PEN_SIZE = 6

function toSvgPath(pts: number[][]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q ${pts[i][0]},${pts[i][1]} ${mx},${my}`
  }
  d += ` Z`
  return d
}

function computePath(points: [number, number, number][]): string {
  const outline = getStroke(points, { size: PEN_SIZE, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
  return toSvgPath(outline)
}

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.cssText = 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none;'
  return svg
}

function makePath(color: string): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('fill', color)
  return path
}

// Render a filled circle into the button to represent the pen color + size
function mountButtonIndicator(btn: HTMLElement, color: string): () => void {
  const prev = btn.innerHTML
  const r = Math.ceil(PEN_SIZE / 2)
  const size = r * 2 + 4
  btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}"/>
  </svg>`
  return () => { btn.innerHTML = prev }
}

// ============================================================================
// Factory
// ============================================================================

interface PointerDetail {
  canvasX: number
  canvasY: number
}

function createPenTool(color: string) {
  return function (handle: DocHandle<CanvasDoc>, buttonEl: HTMLElement): Disposer {
    let points: [number, number, number][] = []
    let previewSvg: SVGSVGElement | null = null
    let previewPath: SVGPathElement | null = null

    const removeIndicator = mountButtonIndicator(buttonEl, color)

    function getLayer(): HTMLElement | null {
      return buttonEl.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
    }

    function onPointerDown(e: Event) {
      const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
      points = [[canvasX, canvasY, 0.5]]

      previewSvg = makeSvg()
      previewPath = makePath(color)
      previewSvg.appendChild(previewPath)
      getLayer()?.appendChild(previewSvg)
    }

    function onPointerMove(e: Event) {
      if (!previewPath) return
      const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
      points.push([canvasX, canvasY, 0.5])
      previewPath.setAttribute('d', computePath(points))
    }

    function onPointerUp(e: Event) {
      if (points.length === 0) return
      const { canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail
      points.push([canvasX, canvasY, 0.5])

      if (points.length > 1) {
        const doc = handle.doc()
        const zIndex = doc ? nextZIndex(doc) : 0
        const shape: PenShape = {
          id: newId(),
          type: 'pen',
          x: 0,
          y: 0,
          zIndex,
          color,
          points,
        }
        createShape(handle, shape)
      }

      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    function cleanup() {
      previewSvg?.remove()
      previewSvg = null
      previewPath = null
      points = []
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
      removeIndicator()
      cleanup()
    }
  }
}

// ============================================================================
// Exports — three pens, each closes over its color
// ============================================================================

export function PenBlackTool(handle: DocHandle<CanvasDoc>, btn: HTMLElement): Disposer {
  return createPenTool('#1a1a1a')(handle, btn)
}

export function PenBlueTool(handle: DocHandle<CanvasDoc>, btn: HTMLElement): Disposer {
  return createPenTool('#1a6edb')(handle, btn)
}

export function PenRedTool(handle: DocHandle<CanvasDoc>, btn: HTMLElement): Disposer {
  return createPenTool('#e03131')(handle, btn)
}
