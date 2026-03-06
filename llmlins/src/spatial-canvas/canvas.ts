import type {
  AutomergeUrl, Camera, Rect, CanvasDoc, CanvasShape, DocHandle, Disposer
} from './types.js'
import { newId, nextZIndex } from './commands.js'
import { updateCamera, zoomCamera } from './camera.js'
import { createShapeTree } from './shape-tree.js'
import { Inputs } from './inputs.js'
import { createSelectTool } from './tools/select.js'
import { createPanTool } from './tools/pan.js'
import { createPlaceTool } from './tools/place.js'
import { PerformanceMode, applyPerformanceMode } from './performance.js'
import { mountEmbed, getToolsForType } from './embed.js'
import { mountToken } from './token.js'
import type { Repo } from '@automerge/automerge-repo'
import { createDocOfDatatype2, getRegistry } from '@inkandswitch/patchwork-plugins'
import type { LoadedDatatypePlugin } from '@inkandswitch/patchwork-plugins'

import canvasCss  from './css/canvas.css?inline'
import shapesCss  from './css/shapes.css?inline'
import handlesCss from './css/handles.css?inline'
import colorsCss  from '../shared/colors.css?inline'

declare const __BUILD_VERSION__: string

type ActiveTool = 'select' | 'pan' | 'place'

/**
 * Normalize WheelEvent delta to pixels regardless of deltaMode.
 * deltaMode 0 = pixels (pass through), 1 = lines (~17px), 2 = pages (~400px).
 */
function normalizeDelta(e: WheelEvent): [number, number] {
  const factor = e.deltaMode === 1 ? 17 : e.deltaMode === 2 ? 400 : 1
  return [e.deltaX * factor, e.deltaY * factor]
}

/**
 * CanvasView — the top-level spatial canvas component.
 *
 * Builds the DOM, wires events, subscribes to Automerge, and coordinates all
 * the sub-systems. Returns a dispose() function for cleanup.
 */
export class CanvasView {
  private container: HTMLElement
  private canvasEl: HTMLElement
  private layer: HTMLElement
  private shapesEl: HTMLElement
  private handlesEl: HTMLElement
  private brushEl: HTMLElement
  private placePreviewEl: HTMLElement
  private cursorsEl: HTMLElement
  private toolbarEl: HTMLElement
  private buildInfoEl: HTMLElement

  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private screenBounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private selectedIds = new Set<string>()
  private activeTool: ActiveTool = 'select'

  private doc: CanvasDoc = { shapes: {} }
  private inputs = new Inputs()
  private shapeTree: ReturnType<typeof createShapeTree>
  private selectTool: ReturnType<typeof createSelectTool>
  private panTool: ReturnType<typeof createPanTool>
  private placeTool: ReturnType<typeof createPlaceTool>

  private spaceDown = false
  private activePointerId: number | null = null
  private isPanning = false   // true while a pan drag is active
  private selectedDatatypeId = ''
  private pendingDocUrl: AutomergeUrl | undefined = undefined
  private pendingShapeType: CanvasShape['shapeType'] = 'embed'

  private repo: Repo | undefined
  private plusPopupEl: HTMLElement | null = null

  private disposers: Disposer[] = []

  constructor(
    private handle: DocHandle<CanvasDoc>,
    mountPoint: HTMLElement
  ) {
    injectStyles()

    // Build DOM scaffold
    this.container = document.createElement('div')
    this.container.className = 'sc-container'

    this.canvasEl = document.createElement('div')
    this.canvasEl.className = 'sc-canvas'

    this.layer = document.createElement('div')
    this.layer.className = 'sc-layer'

    this.shapesEl = document.createElement('div')
    this.shapesEl.className = 'sc-shapes'

    this.handlesEl = document.createElement('div')
    this.handlesEl.className = 'sc-handles'

    this.brushEl = document.createElement('div')
    this.brushEl.className = 'sc-brush'

    this.placePreviewEl = document.createElement('div')
    this.placePreviewEl.className = 'sc-place-preview'

    this.cursorsEl = document.createElement('div')
    this.cursorsEl.className = 'sc-cursors'

    this.toolbarEl = document.createElement('div')
    this.toolbarEl.className = 'sc-toolbar'

    this.layer.appendChild(this.shapesEl)
    this.layer.appendChild(this.handlesEl)
    this.layer.appendChild(this.brushEl)
    this.layer.appendChild(this.placePreviewEl)
    this.canvasEl.appendChild(this.layer)
    this.canvasEl.appendChild(this.cursorsEl)
    this.buildInfoEl = document.createElement('div')
    this.buildInfoEl.className = 'sc-build-info'
    this.buildInfoEl.textContent = __BUILD_VERSION__

    this.container.appendChild(this.canvasEl)
    this.container.appendChild(this.toolbarEl)
    this.container.appendChild(this.buildInfoEl)
    mountPoint.appendChild(this.container)

    const lastVersion = localStorage.getItem('sc-build-version')
    if (lastVersion !== __BUILD_VERSION__) {
      this.buildInfoEl.classList.add('sc-build-info--new')
      localStorage.setItem('sc-build-version', __BUILD_VERSION__)
      setTimeout(() => this.buildInfoEl.classList.remove('sc-build-info--new'), 5000)
    }

    this.repo = (mountPoint as unknown as { repo?: Repo }).repo

    // Seed bounds and screenBounds immediately after mounting so the first
    // viewport computation uses real dimensions rather than {0,0,0,0}.
    const initialRect = this.canvasEl.getBoundingClientRect()
    this.inputs.updateBounds(initialRect)
    this.screenBounds = {
      x: 0, y: 0,
      width:  initialRect.width,
      height: initialRect.height,
    }

    // Shape tree must be initialized before updateCamera, which immediately
    // fires onViewport → refreshViewport → shapeTree.updateViewport()
    this.shapeTree = createShapeTree(this.shapesEl, (el, shape) => {
      if (shape.shapeType === 'token') return mountToken(el, shape)
      if (shape.shapeType === 'bare') return mountToken(el, shape)
      return mountEmbed(
        el,
        shape,
        (newToolId) => handle.change(doc => { doc.shapes[shape.id].toolId = newToolId }),
        (newDocUrl) => handle.change(doc => { doc.shapes[shape.id].docUrl = newDocUrl }),
        () => handle.change(doc => { delete doc.shapes[shape.id] }),
        this.repo
      )
    })

    // Initialize camera (writes CSS variables to DOM)
    this.camera = updateCamera(
      { x: 0, y: 0, zoom: 1 },
      this.container,
      this.layer,
      (cam) => this.onViewport(cam)
    )

    // Tools
    this.selectTool = createSelectTool({
      getCamera:        () => this.camera,
      getDoc:           () => this.doc,
      getHandle:        () => this.handle,
      getSelectedIds:   () => this.selectedIds,
      setSelectedIds:   (ids) => this.setSelectedIds(ids),
      getBrushEl:       () => this.brushEl,
      getContainer:     () => this.container,
      getCanvasBounds:  () => this.inputs.bounds,
      onTranslatePreview: (moves) => this.onTranslatePreview(moves),
      onResizePreview:    (id, next) => this.onResizePreview(id, next),
      capturePointer:   () => this.captureActivePointer(),
    })

    this.panTool = createPanTool({
      getCamera:      () => this.camera,
      getContainer:   () => this.container,
      getLayer:       () => this.layer,
      onViewport:     (cam) => this.onViewport(cam),
      onCameraChange: (cam) => { this.camera = cam },
    })

    this.placeTool = createPlaceTool({
      getDoc:             () => this.doc,
      getHandle:          () => this.handle,
      onPlaced:           () => this.setActiveTool('select'),
      createChildDoc:     (_datatypeId) => {
        const url = this.pendingDocUrl
        this.pendingDocUrl = undefined
        return url
      },
      getDatatypeId:      () => this.selectedDatatypeId,
      getShapeType:       () => this.pendingShapeType,
      getPlacePreviewEl:  () => this.placePreviewEl,
      capturePointer:     () => this.captureActivePointer(),
    })

    // Toolbar
    this.buildToolbar()

    // ResizeObserver — update both screenBounds (for culling) and inputs.bounds
    // (for coordinate transforms; getBoundingClientRect gives position too)
    const ro = new ResizeObserver(() => {
      const rect = this.canvasEl.getBoundingClientRect()
      this.inputs.updateBounds(rect)
      this.screenBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
      this.refreshViewport()
    })
    ro.observe(this.canvasEl)
    this.disposers.push(() => ro.disconnect())

    // Automerge subscription
    const onChange = (payload: { doc: CanvasDoc }) => {
      this.doc = payload.doc
      this.refreshViewport()
    }
    this.handle.on('change', onChange)
    this.disposers.push(() => this.handle.off('change', onChange))

    // Seed initial doc
    const initial = this.handle.doc()
    if (initial) {
      this.doc = initial
      this.refreshViewport()
    }

    // Pointer + wheel events
    this.bindEvents()
  }

  // -------------------------------------------------------------------------
  // Pointer capture (lazy — called by tools when drag is confirmed)
  // -------------------------------------------------------------------------

  private captureActivePointer() {
    if (this.activePointerId !== null) {
      this.canvasEl.setPointerCapture(this.activePointerId)
      this.container.classList.add('sc-translating')
    }
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  private bindEvents() {
    const canvas = this.canvasEl

    const isInsidePatchworkView = (e: Event): boolean => {
      for (const el of e.composedPath()) {
        if (el === canvas) break
        if (el instanceof Element && el.tagName.toLowerCase() === 'patchwork-view') return true
      }
      return false
    }

    const isKeyboardFocusInPatchworkView = (): boolean =>
      !!(document.activeElement?.closest('patchwork-view'))

    const onPointerDown = (e: PointerEvent) => {
      const insidePW = isInsidePatchworkView(e)
      // Middle click or space+any button → pan (always capture immediately)
      if (e.button === 1 || this.spaceDown) {
        canvas.setPointerCapture(e.pointerId)
        this.activePointerId = e.pointerId
        this.isPanning = true
        canvas.style.cursor = 'grabbing'
        const info = this.inputs.onPointerDown(e, this.camera)
        this.panTool.onPointerDown(info)
        return
      }
      if (e.button !== 0) return

      this.activePointerId = e.pointerId
      if (!insidePW) {
        // Immediate capture for clicks directly on the canvas surface or handles.
        canvas.setPointerCapture(e.pointerId)
      }
      // Inside patchwork-view: skip immediate capture so the embed receives
      // pointerup for plain clicks. Tools call capturePointer() if drag detected.
      const info = this.inputs.onPointerDown(e, this.camera)
      this.currentTool().onPointerDown(info)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return
      const info = this.inputs.onPointerMove(e, this.camera)
      if (this.activePointerId !== null) {
        if (this.isPanning || e.buttons === 4) {
          this.panTool.onPointerMove(info)
        } else {
          this.currentTool().onPointerMove(info)
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return
      this.activePointerId = null
      this.container.classList.remove('sc-translating')
      const info = this.inputs.onPointerUp(e, this.camera)
      if (this.isPanning) {
        this.isPanning = false
        canvas.style.cursor = this.spaceDown ? 'grab' : ''
        this.panTool.onPointerUp(info)
      } else {
        this.currentTool().onPointerUp(info)
      }
    }

    // pointercancel: browser took over (e.g. notification bar swipe-in on mobile).
    // Cancel the active session — never complete it.
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return
      this.activePointerId = null
      this.isPanning = false
      this.container.classList.remove('sc-translating')
      canvas.style.cursor = this.spaceDown ? 'grab' : ''
      if (this.selectTool) this.selectTool.cancel()
      this.panTool.cancel()
      applyPerformanceMode(PerformanceMode.Idle, this.container)
    }

    const onWheel = (e: WheelEvent) => {
      if (isInsidePatchworkView(e)) return
      e.preventDefault()

      const [rawDx, rawDy] = normalizeDelta(e)

      // Skip zero-delta events (some trackpads fire trailing bursts of zeros)
      if (rawDx === 0 && rawDy === 0) return

      // Zoom: ctrl+scroll (trackpad pinch-to-zoom reports ctrlKey=true) or alt+scroll.
      // e.buttons === 0 guard prevents accidental zoom during ctrl+mouse-drag.
      if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
        const rect = this.inputs.bounds
        const next = zoomCamera(
          this.camera,
          e.clientX - rect.left,
          e.clientY - rect.top,
          rawDy
        )
        this.camera = updateCamera(next, this.container, this.layer, (cam) => this.onViewport(cam))
      } else {
        // Pan — trackpads produce X+Y deltas, mice produce Y only
        const dx = e.shiftKey ? rawDy : rawDx
        const dy = e.shiftKey ? 0     : rawDy
        const next: Camera = {
          ...this.camera,
          x: this.camera.x - dx / this.camera.zoom,
          y: this.camera.y - dy / this.camera.zoom,
        }
        this.camera = updateCamera(next, this.container, this.layer, (cam) => this.onViewport(cam))
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardFocusInPatchworkView()) return
      if (e.code === 'Space' && !e.repeat) {
        this.spaceDown = true
        if (!this.isPanning) canvas.style.cursor = 'grab'
      }
      if (e.key === 'v') this.setActiveTool('select')
      if (e.key === 'r') this.setActiveTool('place')
      if (e.key === 'h') this.setActiveTool('pan')

      if (this.activeTool === 'select') this.selectTool.onKeyDown(e)
      if (this.activeTool === 'place')  this.placeTool.onKeyDown(e)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isKeyboardFocusInPatchworkView()) return
      if (e.code === 'Space') {
        this.spaceDown = false
        if (!this.isPanning) canvas.style.cursor = ''
      }
    }

    // iOS Safari: prevent proprietary gesture events from triggering native
    // zoom or swipe navigation before our pointer events are processed.
    const preventGesture = (e: Event) => e.preventDefault()

    // iOS edge-swipe navigation prevention — fires when a touch near the
    // screen edge would trigger browser swipe-back/forward. Uses radiusX (the
    // touch contact area width) so large fingertips near the edge are caught
    // even if the touch centre is slightly inside the 10px threshold.
    const preventEdgeSwipe = (e: TouchEvent) => {
      const x = e.touches[0].pageX
      const r = e.touches[0].radiusX || 0
      if (x - r < 10 || x + r > this.screenBounds.width - 10) {
        e.preventDefault()
      }
    }

    // -----------------------------------------------------------------------
    // Drag-and-drop — accept text/x-patchwork-urls drops
    // -----------------------------------------------------------------------

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return
      // Only accept drops that carry our custom MIME type
      if ([...e.dataTransfer.types].includes('text/x-patchwork-urls')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      if (!e.dataTransfer) return

      const raw = e.dataTransfer.getData('text/x-patchwork-urls')
      if (!raw) return

      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return }
      if (!Array.isArray(parsed) || parsed.length === 0) return

      const docUrls = (parsed as unknown[]).filter((u): u is AutomergeUrl => typeof u === 'string')
      if (docUrls.length === 0) return

      // Convert the screen-space drop point to page coordinates
      const rect = this.inputs.bounds
      const dropX = (e.clientX - rect.left) / this.camera.zoom - this.camera.x
      const dropY = (e.clientY - rect.top)  / this.camera.zoom - this.camera.y

      const W = 640
      const H = 480
      const GAP = 16

      // Create all shapes immediately; toolIds are patched in below once
      // getTools resolves asynchronously.
      const baseZ = nextZIndex(this.doc)
      const ids: string[] = docUrls.map(() => newId())

      this.handle.change(doc => {
        docUrls.forEach((docUrl, i) => {
          doc.shapes[ids[i]] = {
            id:        ids[i],
            x:         dropX + i * (W + GAP),
            y:         dropY,
            width:     W,
            height:    H,
            rotation:  0,
            zIndex:    baseZ + i,
            docUrl,
            shapeType: 'embed',
          }
        })
      })

      // Resolve the best default tool for each dropped document and update
      // the shape once known.  We look up the doc's @patchwork.type and pick
      // the first compatible tool from the registry.
      if (this.repo) {
        docUrls.forEach((docUrl, i) => {
          const id = ids[i]
          this.repo!.find<Record<string, unknown>>(docUrl).then(async handle => {
            await handle.whenReady()
            const doc = handle.doc()
            const patchwork = doc?.['@patchwork'] as { type?: string } | undefined
            const datatypeId = patchwork?.type ?? ''
            const tools = getToolsForType(datatypeId)
            const toolId = tools[0]?.id ?? ''
            if (toolId) {
              this.handle.change(doc => {
                if (doc.shapes[id]) doc.shapes[id].toolId = toolId
              })
            }
          }).catch(() => { /* leave toolId as '' — patchwork-view picks its own default */ })
        })
      }
    }

    // When text selection starts inside a patchwork-view, cancel any pending
    // shape translate so the browser's native text selection wins.
    const onSelectStart = (e: Event) => {
      if (isInsidePatchworkView(e)) this.selectTool.cancel()
    }

    canvas.addEventListener('pointerdown',  onPointerDown)
    canvas.addEventListener('pointermove',  onPointerMove)
    canvas.addEventListener('pointerup',    onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('wheel',        onWheel as EventListener, { passive: false })
    canvas.addEventListener('dragover',     onDragOver)
    canvas.addEventListener('drop',         onDrop)
    canvas.addEventListener('selectstart',  onSelectStart)
    window.addEventListener('keydown',      onKeyDown)
    window.addEventListener('keyup',        onKeyUp)

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
      canvas.removeEventListener('dragover',      onDragOver)
      canvas.removeEventListener('drop',          onDrop)
      canvas.removeEventListener('selectstart',   onSelectStart)
      window.removeEventListener('keydown',       onKeyDown)
      window.removeEventListener('keyup',         onKeyUp)
      // @ts-ignore
      document.removeEventListener('gesturestart',  preventGesture)
      // @ts-ignore
      document.removeEventListener('gesturechange', preventGesture)
      // @ts-ignore
      canvas.removeEventListener('gestureend',      preventGesture)
      canvas.removeEventListener('touchstart',    preventEdgeSwipe)
    })
  }

  // -------------------------------------------------------------------------
  // Tool routing
  // -------------------------------------------------------------------------

  private currentTool() {
    switch (this.activeTool) {
      case 'pan':    return this.panTool
      case 'place':  return this.placeTool
      default:       return this.selectTool
    }
  }

  setActiveTool(tool: ActiveTool) {
    this.selectTool.cancel()
    this.panTool.cancel()
    this.placeTool.cancel()
    this.activeTool = tool
    this.canvasEl.dataset.tool = tool
    this.updateToolbarActive()
    applyPerformanceMode(PerformanceMode.Idle, this.container)
  }

  // -------------------------------------------------------------------------
  // Viewport & shape tree
  // -------------------------------------------------------------------------

  private onViewport(camera: Camera) {
    this.camera = camera
    this.refreshViewport()
  }

  private refreshViewport() {
    this.shapeTree.updateViewport(
      this.camera,
      this.screenBounds,
      this.doc,
      this.selectedIds
    )
    this.refreshHandles()
  }

  private setSelectedIds(ids: Set<string>) {
    const prev = this.selectedIds
    this.selectedIds = ids
    this.shapeTree.syncSelection(ids)
    this.refreshHandles()

    // Bring newly selected shapes to the front in the doc
    const newlySelected = [...ids].filter(id => !prev.has(id))
    if (newlySelected.length > 0) {
      this.handle.change(doc => {
        let topZ = nextZIndex(doc) - 1
        for (const id of newlySelected) {
          if (doc.shapes[id]) {
            topZ += 1
            doc.shapes[id].zIndex = topZ
          }
        }
      })
    }
  }

  // -------------------------------------------------------------------------
  // Live previews (in-memory, before Automerge commit)
  // -------------------------------------------------------------------------

  private onTranslatePreview(moves: Map<string, { x: number; y: number }>) {
    const mounted = this.shapeTree.getMounted()
    for (const [id, pos] of moves) {
      const ms = mounted.get(id)
      const shape = this.doc.shapes[id]
      if (ms && shape) {
        ms.updatePosition({ ...shape, x: pos.x, y: pos.y })
      }
    }
    this.refreshHandles(moves)
  }

  private onResizePreview(id: string, next: Partial<CanvasShape>) {
    const mounted = this.shapeTree.getMounted()
    const ms = mounted.get(id)
    const shape = this.doc.shapes[id]
    if (ms && shape) {
      ms.updatePosition({ ...shape, ...next })
    }
    this.refreshHandles(new Map([[id, next]]))
  }

  // -------------------------------------------------------------------------
  // Selection handles
  // -------------------------------------------------------------------------

  private refreshHandles(overrides?: Map<string, Partial<CanvasShape>>) {
    this.handlesEl.innerHTML = ''

    // Selection box for all selected shapes (bounding box)
    if (this.selectedIds.size > 0) {
      const selectedShapes = [...this.selectedIds]
        .map(id => {
          const base = this.doc.shapes[id]
          if (!base) return undefined
          const ov = overrides?.get(id)
          return ov ? { ...base, ...ov } : base
        })
        .filter((s): s is CanvasShape => s != null)

      if (selectedShapes.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const s of selectedShapes) {
          minX = Math.min(minX, s.x)
          minY = Math.min(minY, s.y)
          maxX = Math.max(maxX, s.x + s.width)
          maxY = Math.max(maxY, s.y + s.height)
        }
        // Expand by 2 screen pixels so the ring sits outside the shape content
        // rather than being swallowed by full-bleed embeds (e.g. bare/llmlin).
        const EXPAND = 2 / this.camera.zoom
        const box = document.createElement('div')
        box.className = 'sc-selection-box'
        box.style.cssText = `left:${minX - EXPAND}px;top:${minY - EXPAND}px;width:${maxX - minX + EXPAND * 2}px;height:${maxY - minY + EXPAND * 2}px;`
        this.handlesEl.appendChild(box)
      }
    }

    // Render resize handle hit areas for ALL non-token shapes (cursor feedback always on)
    for (const shape of Object.values(this.doc.shapes)) {
      if (shape.shapeType === 'token') continue
      const ov = overrides?.get(shape.id)
      const s = ov ? { ...shape, ...ov } : shape
      this.renderShapeHandles(s)
    }
  }

  private renderShapeHandles(s: CanvasShape) {
    const screenW = s.width * this.camera.zoom
    const screenH = s.height * this.camera.zoom
    const showCorners = Math.min(screenW, screenH) > 20
    const showEdges   = Math.min(screenW, screenH) > 24

    const isMobile = this.screenBounds.width < 768
    const CORNER_HIT = (isMobile ? 32 : 16) / this.camera.zoom
    const EDGE_HIT   = (isMobile ? 20 : 10) / this.camera.zoom

    if (showCorners) {
      const corners = [
        { corner: 'nw', lx: s.x,           ly: s.y },
        { corner: 'ne', lx: s.x + s.width,  ly: s.y },
        { corner: 'se', lx: s.x + s.width,  ly: s.y + s.height },
        { corner: 'sw', lx: s.x,            ly: s.y + s.height },
      ]
      for (const h of corners) {
        const el = document.createElement('div')
        el.className = 'sc-handle'
        el.dataset.corner = h.corner
        el.dataset.shapeId = s.id
        el.style.cssText = [
          `left:${h.lx - CORNER_HIT/2}px`,
          `top:${h.ly - CORNER_HIT/2}px`,
          `width:${CORNER_HIT}px`,
          `height:${CORNER_HIT}px`,
          'pointer-events:auto',
          'position:absolute',
        ].join(';')
        this.handlesEl.appendChild(el)
      }
    }

    if (showEdges) {
      // Full-edge hit areas: N/S span full width, E/W span full height
      // Inset by CORNER_HIT/2 so corners take priority at the ends
      const inset = CORNER_HIT / 2
      const edges = [
        {
          edge: 'n',
          cssText: [
            `left:${s.x + inset}px`,
            `top:${s.y - EDGE_HIT/2}px`,
            `width:${Math.max(s.width - inset*2, 0)}px`,
            `height:${EDGE_HIT}px`,
          ].join(';'),
        },
        {
          edge: 'e',
          cssText: [
            `left:${s.x + s.width - EDGE_HIT/2}px`,
            `top:${s.y + inset}px`,
            `width:${EDGE_HIT}px`,
            `height:${Math.max(s.height - inset*2, 0)}px`,
          ].join(';'),
        },
        {
          edge: 's',
          cssText: [
            `left:${s.x + inset}px`,
            `top:${s.y + s.height - EDGE_HIT/2}px`,
            `width:${Math.max(s.width - inset*2, 0)}px`,
            `height:${EDGE_HIT}px`,
          ].join(';'),
        },
        {
          edge: 'w',
          cssText: [
            `left:${s.x - EDGE_HIT/2}px`,
            `top:${s.y + inset}px`,
            `width:${EDGE_HIT}px`,
            `height:${Math.max(s.height - inset*2, 0)}px`,
          ].join(';'),
        },
      ]
      for (const h of edges) {
        const el = document.createElement('div')
        el.className = 'sc-handle'
        el.dataset.edge = h.edge
        el.dataset.shapeId = s.id
        el.style.cssText = h.cssText + ';pointer-events:auto;position:absolute;'
        this.handlesEl.appendChild(el)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Toolbar
  // -------------------------------------------------------------------------



  private buildToolbar() {
    const navButtons: { tool: ActiveTool; label: string; title: string }[] = [
      { tool: 'select', label: '↖', title: 'Select (V)' },
      { tool: 'pan',    label: '✋', title: 'Pan (H)' },
    ]

    for (const { tool, label, title } of navButtons) {
      const btn = document.createElement('button')
      btn.className = 'sc-tool-btn'
      btn.dataset.toolTarget = tool
      btn.textContent = label
      btn.title = title
      btn.addEventListener('click', () => this.setActiveTool(tool))
      this.toolbarEl.appendChild(btn)
    }

    // LLMlin quick-place button — always 'bare' shape, not available via "+" popup
    const llmlinIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 8 C5 5.5 11 5.5 12.5 8 C11 10.5 5 10.5 3.5 8Z" stroke="currentColor" stroke-width="1.1" fill="none"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>`
    const llmlinBtn = document.createElement('button')
    llmlinBtn.className = 'sc-tool-btn sc-quick-place-btn'
    llmlinBtn.innerHTML = llmlinIcon
    llmlinBtn.title = 'Create LLMlin'
    llmlinBtn.addEventListener('click', () => {
      this.closePlusPopup()
      this.selectForPlace('llmlin', 'bare')
    })
    this.toolbarEl.appendChild(llmlinBtn)

    // "+" button — opens a popup to pick any datatype to draw as an embed
    const plusBtn = document.createElement('button')
    plusBtn.className = 'sc-tool-btn sc-plus-btn'
    plusBtn.textContent = '+'
    plusBtn.title = 'Create new embed'
    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.plusPopupEl) {
        this.closePlusPopup()
      } else {
        this.openPlusPopup(plusBtn)
      }
    })
    this.toolbarEl.appendChild(plusBtn)

    this.updateToolbarActive()
  }

  private openPlusPopup(anchor: HTMLElement) {
    this.closePlusPopup()

    const popup = document.createElement('div')
    popup.className = 'sc-plus-popup'
    popup.style.cssText = `
      position: absolute;
      min-width: 180px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      padding: 6px 0;
      z-index: 1000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      overflow-y: auto;
    `

    const renderList = () => {
      popup.innerHTML = ''
      const registry = getRegistry('patchwork:datatype')
      const datatypes = (registry.all() as LoadedDatatypePlugin[]).filter(p => {
        const p2 = p as LoadedDatatypePlugin & { unlisted?: boolean; hidden?: boolean }
        return !p2.unlisted && !p2.hidden
      })

      if (datatypes.length === 0) {
        const empty = document.createElement('div')
        empty.textContent = 'No types available'
        empty.style.cssText = 'padding: 8px 14px; color: #9ca3af;'
        popup.appendChild(empty)
        return
      }

      for (const plugin of datatypes) {
        const item = document.createElement('button')
        item.style.cssText = `
          display: block;
          width: 100%;
          padding: 7px 14px;
          border: none;
          background: transparent;
          text-align: left;
          cursor: pointer;
          color: #111827;
          font-size: 13px;
          font-family: inherit;
        `
        item.textContent = plugin.name
        item.addEventListener('mouseenter', () => { item.style.background = '#f3f4f6' })
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
        item.addEventListener('click', () => {
          this.closePlusPopup()
          this.selectForPlace(plugin.id, 'embed')
        })
        popup.appendChild(item)
      }
    }

    renderList()
    const unsub = getRegistry('patchwork:datatype').on('changed', renderList)

    // Position relative to the container so the popup stays in the same
    // stacking context and never triggers a body-level layout reflow.
    const containerRect = this.container.getBoundingClientRect()
    const anchorRect    = anchor.getBoundingClientRect()
    const bottomOffset  = containerRect.bottom - anchorRect.top + 6
    const leftOffset    = anchorRect.left - containerRect.left
    const maxH          = anchorRect.top - containerRect.top - 16
    popup.style.bottom    = `${bottomOffset}px`
    popup.style.left      = `${leftOffset}px`
    popup.style.maxHeight = `${Math.max(maxH, 80)}px`

    this.container.appendChild(popup)
    this.plusPopupEl = popup

    // Close on outside pointerdown
    const onOutside = (e: PointerEvent) => {
      if (!popup.contains(e.target as Node) && e.target !== anchor) {
        this.closePlusPopup()
      }
    }
    document.addEventListener('pointerdown', onOutside, { capture: true })

    // Store cleanup
    ;(popup as HTMLElement & { _cleanup?: () => void })._cleanup = () => {
      unsub()
      document.removeEventListener('pointerdown', onOutside, { capture: true })
    }
  }

  private closePlusPopup() {
    if (!this.plusPopupEl) return
    const el = this.plusPopupEl as HTMLElement & { _cleanup?: () => void }
    el._cleanup?.()
    el.remove()
    this.plusPopupEl = null
  }

  private async selectForPlace(datatypeId: string, shapeType: CanvasShape['shapeType']) {
    this.selectedDatatypeId = datatypeId
    this.pendingShapeType = shapeType
    this.pendingDocUrl = undefined
    this.setActiveTool('place')

    // Pre-create the doc so it's ready when the user finishes drawing
    if (this.repo) {
      try {
        const registry = getRegistry('patchwork:datatype')
        const loaded = await registry.load(datatypeId) as LoadedDatatypePlugin | null
        if (loaded) {
          const docHandle = await createDocOfDatatype2(loaded, this.repo)
          this.pendingDocUrl = docHandle.url as AutomergeUrl
        }
      } catch (err) {
        console.error('[spatial-canvas] doc pre-creation failed:', err)
      }
    }
  }

  private updateToolbarActive() {
    const btns = Array.from(this.toolbarEl.querySelectorAll<HTMLElement>('.sc-tool-btn'))
    for (const btn of btns) {
      const target = btn.dataset.toolTarget
      if (target) {
        btn.classList.toggle('active', target === this.activeTool)
      }
    }

  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose() {
    for (const d of this.disposers) d()
    this.shapeTree.dispose()
    this.container.remove()
  }
}

// -------------------------------------------------------------------------
// Style injection (once per document)
// -------------------------------------------------------------------------

let stylesInjected = false

function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true

  const style = document.createElement('style')
  style.textContent = colorsCss + canvasCss + shapesCss + handlesCss
  document.head.appendChild(style)
}
