import type { Camera, Rect, CanvasDoc, DocHandle, Disposer } from './types.js'
import { updateCamera, zoomCamera } from './camera.js'
import { Inputs } from './inputs.js'
import { getRegistry } from '@inkandswitch/patchwork-plugins'

import canvasCss from './css/canvas.css?inline'

/**
 * Normalize WheelEvent delta to pixels regardless of deltaMode.
 * deltaMode 0 = pixels (pass through), 1 = lines (~17px), 2 = pages (~400px).
 */
function normalizeDelta(e: WheelEvent): [number, number] {
  const factor = e.deltaMode === 1 ? 17 : e.deltaMode === 2 ? 400 : 1
  return [e.deltaX * factor, e.deltaY * factor]
}

/**
 * CanvasView — the core spatial canvas host.
 *
 * Responsibilities:
 *  - Build the DOM scaffold (container, canvas, layer, toolbar)
 *  - Own the camera (wheel zoom + scroll pan)
 *  - Discover toolbar tools from the patchwork registry (tag: spatial-canvas-tool)
 *    and mount each tool's implementation onto its button element
 *  - Discover render layers from the registry (tag: spatial-canvas-layer)
 *    and mount each layer into the transform layer
 *  - Dispatch spatial-canvas:pointer* CustomEvents to the active tool's button
 *
 * Tools and layers are fully responsible for their own logic. The canvas
 * does not manage selection, drag sessions, or shape rendering directly.
 */
export class CanvasView {
  private container: HTMLElement
  private canvasEl: HTMLElement
  private layer: HTMLElement
  private toolbarEl: HTMLElement

  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private screenBounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private activeTool: string = ''
  private activePointerId: number | null = null

  private inputs = new Inputs()
  private disposers: Disposer[] = []

  constructor(
    private handle: DocHandle<CanvasDoc>,
    mountPoint: HTMLElement,
  ) {
    injectStyles()

    // Build DOM scaffold
    this.container = document.createElement('div')
    this.container.className = 'sc-container'

    this.canvasEl = document.createElement('div')
    this.canvasEl.className = 'sc-canvas'

    this.layer = document.createElement('div')
    this.layer.className = 'sc-layer'

    this.toolbarEl = document.createElement('div')
    this.toolbarEl.className = 'sc-toolbar'

    this.canvasEl.appendChild(this.layer)
    this.container.appendChild(this.canvasEl)
    this.container.appendChild(this.toolbarEl)
    mountPoint.appendChild(this.container)

    // Seed bounds immediately after mounting so the first coordinate
    // transforms use real dimensions rather than {0,0,0,0}.
    const initialRect = this.canvasEl.getBoundingClientRect()
    this.inputs.updateBounds(initialRect)
    this.screenBounds = { x: 0, y: 0, width: initialRect.width, height: initialRect.height }

    // Initialize camera (writes CSS variables to DOM)
    this.camera = updateCamera(
      { x: 0, y: 0, zoom: 1 },
      this.container,
      this.layer,
      (cam) => { this.camera = cam }
    )

    // Toolbar tools and render layers are discovered from the patchwork registry
    this.buildToolbar()
    this.mountLayers()

    // ResizeObserver — keeps coordinate transforms correct when the canvas resizes
    const ro = new ResizeObserver(() => {
      const rect = this.canvasEl.getBoundingClientRect()
      this.inputs.updateBounds(rect)
      this.screenBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
    })
    ro.observe(this.canvasEl)
    this.disposers.push(() => ro.disconnect())

    this.bindEvents()
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  private bindEvents() {
    const canvas = this.canvasEl

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      canvas.setPointerCapture(e.pointerId)
      this.activePointerId = e.pointerId
      this.dispatchToActiveTool('spatial-canvas:pointerdown', e)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return
      if (this.activePointerId !== null) {
        this.dispatchToActiveTool('spatial-canvas:pointermove', e)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return
      this.activePointerId = null
      this.dispatchToActiveTool('spatial-canvas:pointerup', e)
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return
      this.activePointerId = null
      const btn = this.toolbarEl.querySelector<HTMLElement>(
        `[data-tool-target="${this.activeTool}"]`
      )
      btn?.dispatchEvent(new CustomEvent('spatial-canvas:cancel', { bubbles: false }))
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [rawDx, rawDy] = normalizeDelta(e)
      if (rawDx === 0 && rawDy === 0) return

      if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
        // Zoom — ctrl+scroll or trackpad pinch-to-zoom (ctrlKey=true)
        const rect = this.inputs.bounds
        const next = zoomCamera(
          this.camera,
          e.clientX - rect.left,
          e.clientY - rect.top,
          rawDy
        )
        this.camera = updateCamera(next, this.container, this.layer, (cam) => { this.camera = cam })
      } else {
        // Pan — trackpads produce X+Y deltas, mice produce Y only
        const dx = e.shiftKey ? rawDy : rawDx
        const dy = e.shiftKey ? 0     : rawDy
        const next: Camera = {
          ...this.camera,
          x: this.camera.x - dx / this.camera.zoom,
          y: this.camera.y - dy / this.camera.zoom,
        }
        this.camera = updateCamera(next, this.container, this.layer, (cam) => { this.camera = cam })
      }
    }

    // iOS Safari: prevent proprietary gesture events from triggering native zoom
    const preventGesture = (e: Event) => e.preventDefault()

    // iOS edge-swipe navigation prevention
    const preventEdgeSwipe = (e: TouchEvent) => {
      const x = e.touches[0].pageX
      const r = e.touches[0].radiusX || 0
      if (x - r < 10 || x + r > this.screenBounds.width - 10) {
        e.preventDefault()
      }
    }

    canvas.addEventListener('pointerdown',   onPointerDown)
    canvas.addEventListener('pointermove',   onPointerMove)
    canvas.addEventListener('pointerup',     onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('wheel',         onWheel as EventListener, { passive: false })
    // @ts-ignore — gesturestart/gesturechange/gestureend are WebKit-proprietary
    document.addEventListener('gesturestart',  preventGesture)
    // @ts-ignore
    document.addEventListener('gesturechange', preventGesture)
    // @ts-ignore
    canvas.addEventListener('gestureend',      preventGesture)
    canvas.addEventListener('touchstart', preventEdgeSwipe, { passive: false })

    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown',   onPointerDown)
      canvas.removeEventListener('pointermove',   onPointerMove)
      canvas.removeEventListener('pointerup',     onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('wheel',         onWheel as EventListener)
      // @ts-ignore
      document.removeEventListener('gesturestart',  preventGesture)
      // @ts-ignore
      document.removeEventListener('gesturechange', preventGesture)
      // @ts-ignore
      canvas.removeEventListener('gestureend',      preventGesture)
      canvas.removeEventListener('touchstart',    preventEdgeSwipe)
    })
  }

  // ---------------------------------------------------------------------------
  // Active tool dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a spatial-canvas pointer CustomEvent to the currently active
   * tool's button element. The detail includes canvas-space coordinates
   * already transformed from screen space via the current camera, plus raw
   * screen coordinates and modifier keys.
   *
   * Tool implementations listen on their own button element for these events
   * and can call handle.change() directly without needing access to any
   * internal canvas state.
   */
  private dispatchToActiveTool(type: string, e: PointerEvent) {
    const btn = this.toolbarEl.querySelector<HTMLElement>(
      `[data-tool-target="${this.activeTool}"]`
    )
    if (!btn) return
    const page = this.inputs.screenToPage(e.clientX, e.clientY, this.camera)
    btn.dispatchEvent(new CustomEvent(type, {
      detail: {
        canvasX: page.x,
        canvasY: page.y,
        screenX: e.clientX,
        screenY: e.clientY,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      },
      bubbles: false,
    }))
  }

  setActiveTool(tool: string) {
    const oldBtn = this.toolbarEl.querySelector<HTMLElement>(
      `[data-tool-target="${this.activeTool}"]`
    )
    oldBtn?.dispatchEvent(new CustomEvent('spatial-canvas:cancel', { bubbles: false }))
    this.activeTool = tool
    this.canvasEl.dataset.tool = tool
    this.updateToolbarActive()
  }

  // ---------------------------------------------------------------------------
  // Toolbar — discovered from the patchwork registry by tag
  // ---------------------------------------------------------------------------

  private buildToolbar() {
    const registry = getRegistry('patchwork:tool')
    const toolDescs = registry.filter(
      p => (p.tags as string[] | undefined)?.includes('spatial-canvas-tool')
    )

    for (const desc of toolDescs) {
      const btn = document.createElement('button')
      btn.className = 'sc-tool-btn'
      btn.dataset.toolTarget = desc.id
      btn.textContent = desc.icon ?? desc.name
      btn.title = desc.name
      btn.addEventListener('click', () => this.setActiveTool(desc.id))
      this.toolbarEl.appendChild(btn)

      // Mount the tool's implementation onto the button element.
      // The implementation listens for spatial-canvas:pointer* events on the
      // button and calls handle.change() directly.
      registry.load(desc.id).then(loaded => {
        if (!loaded) return
        const dispose = (loaded.module as (h: DocHandle<CanvasDoc>, el: HTMLElement) => Disposer)(
          this.handle, btn
        )
        this.disposers.push(dispose)
      })
    }

    this.updateToolbarActive()
  }

  private updateToolbarActive() {
    for (const btn of this.toolbarEl.querySelectorAll<HTMLElement>('.sc-tool-btn')) {
      btn.classList.toggle('active', btn.dataset.toolTarget === this.activeTool)
    }
  }

  // ---------------------------------------------------------------------------
  // Layers — discovered from the patchwork registry by tag
  // ---------------------------------------------------------------------------

  private mountLayers() {
    const registry = getRegistry('patchwork:tool')
    const layerDescs = registry.filter(
      p => (p.tags as string[] | undefined)?.includes('spatial-canvas-layer')
    )

    for (const desc of layerDescs) {
      const div = document.createElement('div')
      // No z-index on the container — a positioned element with z-index:auto
      // does NOT form a new stacking context, so elements rendered by different
      // layers interleave freely via their own shape.zIndex values.
      div.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
      this.layer.appendChild(div)

      registry.load(desc.id).then(loaded => {
        if (!loaded) return
        const dispose = (loaded.module as (h: DocHandle<CanvasDoc>, el: HTMLElement) => Disposer)(
          this.handle, div
        )
        this.disposers.push(dispose)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    for (const d of this.disposers) d()
    this.container.remove()
  }
}

// ---------------------------------------------------------------------------
// Style injection (once per document)
// ---------------------------------------------------------------------------

let stylesInjected = false

function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = canvasCss
  document.head.appendChild(style)
}
