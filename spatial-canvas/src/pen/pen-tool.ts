import { getStroke } from 'perfect-freehand'
import type { DocHandle } from '@automerge/automerge-repo'
import type { CanvasDoc, CanvasShape, Disposer } from '../canvas/types.js'
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements'
import type { SpatialCanvasHost } from '../canvas/spatial-canvas-element.js'
import { createShape, nextZIndex, newId } from '../canvas/commands.js'
import { createElement, Pen } from 'lucide'

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
  svg.style.cssText = 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none;z-index:2147483647;'
  return svg
}

function makePath(color: string): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('fill', color)
  return path
}

// ============================================================================
// Tool
// ============================================================================

const DEFAULT_COLOR = '#1a1a1a'

export function PenTool(handle: DocHandle<CanvasDoc>, buttonEl: PatchworkViewElement): Disposer {
  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? 'local'

  let points: [number, number, number][] = []
  let previewSvg: SVGSVGElement | null = null
  let previewPath: SVGPathElement | null = null

  function getColor(): string {
    return handle.doc()?.stateByUser?.[contactUrl]?.color ?? DEFAULT_COLOR
  }

  function getLayer(): HTMLElement | null {
    return buttonEl.closest('.sc-container')?.querySelector<HTMLElement>('.sc-layer') ?? null
  }

  buttonEl.appendChild(createElement(Pen, { width: 22, height: 22, style: 'pointer-events:none' }))

  function getCanvas(e: Event) {
    return (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')?.spatialCanvas ?? null
  }

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY)
    if (!pos) return
    points = [[pos.x, pos.y, 0.5]]

    const color = getColor()
    previewSvg = makeSvg()
    previewPath = makePath(color)
    previewSvg.appendChild(previewPath)
    getLayer()?.appendChild(previewSvg)
  }

  function onPointerMove(e: Event) {
    if (!previewPath) return
    const pe = e as PointerEvent
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY)
    if (!pos) return
    points.push([pos.x, pos.y, 0.5])
    previewPath.setAttribute('d', computePath(points))
  }

  function onPointerUp(e: Event) {
    if (points.length === 0) return
    const pe = e as PointerEvent
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY)
    if (pos) points.push([pos.x, pos.y, 0.5])

    if (points.length > 1) {
      const doc = handle.doc()
      const zIndex = doc ? nextZIndex(doc) : 0
      const shape: PenShape = {
        id: newId(),
        type: 'pen',
        x: 0,
        y: 0,
        zIndex,
        color: getColor(),
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

  buttonEl.addEventListener('pointerdown', onPointerDown)
  buttonEl.addEventListener('pointermove', onPointerMove)
  buttonEl.addEventListener('pointerup',   onPointerUp)
  buttonEl.addEventListener('pointercancel', onCancel)

  return () => {
    buttonEl.removeEventListener('pointerdown', onPointerDown)
    buttonEl.removeEventListener('pointermove', onPointerMove)
    buttonEl.removeEventListener('pointerup',   onPointerUp)
    buttonEl.removeEventListener('pointercancel', onCancel)
    cleanup()
  }
}
