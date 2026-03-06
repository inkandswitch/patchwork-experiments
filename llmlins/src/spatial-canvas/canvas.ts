import type {
  AutomergeUrl, Camera, Rect, CanvasDoc, CanvasShape, DocHandle, Disposer
} from './types.js'
import { newId, nextZIndex } from './commands.js'
import { updateCamera, zoomCamera } from './camera.js'
import { createShapeTree, type ContentMounter } from './shape-tree.js'
import { Inputs } from './inputs.js'
import { createSelectTool } from './tools/select.js'
import { createPanTool } from './tools/pan.js'
import { createPlaceTool } from './tools/place.js'
import { PerformanceMode, applyPerformanceMode } from './performance.js'
import { mountEmbed, type ToolOption } from './embed.js'
import { mountToken } from './token.js'
import type { Repo } from '@automerge/automerge-repo'

import canvasCss  from './css/canvas.css?inline'
import shapesCss  from './css/shapes.css?inline'
import handlesCss from './css/handles.css?inline'

declare const __BUILD_VERSION__: string

type ActiveTool = 'select' | 'pan' | 'place'

export interface DatatypeOption {
  id: string
  name: string
}

export interface CanvasViewOptions {
  /**
   * Called when the PlaceTool needs a new child Automerge document.
   * Receives the selected datatypeId (e.g. 'llmlin', 'spatial-canvas').
   * Returns an AutomergeUrl for the newly created doc, or undefined to leave the
   * docUrl unset (the embed will show a type picker).
   */
  createChildDoc: (datatypeId: string) => AutomergeUrl | undefined
  /**
   * Called to mount content into a shape container.
   * Defaults to dispatching on shapeType: 'embed' → mountEmbed, 'token' → mountToken.
   */
  mountContent?: ContentMounter
  /**
   * Optional tool list supplier for embed shapes.
   * Given a docUrl, resolves to the list of tools that can render that document.
   * If absent, the tool <select> shows only the currently active toolId.
   */
  getTools?: (docUrl: string) => Promise<ToolOption[]>
  /**
   * Datatypes the user can choose to create via the PlaceTool.
   * Shown as a <select> in the toolbar next to the place button.
   * If omitted the PlaceTool creates documents with an empty datatypeId.
   */
  datatypes?: DatatypeOption[]
}

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

  private disposers: Disposer[] = []

  constructor(
    private handle: DocHandle<CanvasDoc>,
    mountPoint: HTMLElement,
    private options: CanvasViewOptions
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

    const repo = (mountPoint as unknown as { repo?: Repo }).repo

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
    const mountContent: ContentMounter = options.mountContent ??
      ((el, shape) => {
        if (shape.shapeType === 'token') return mountToken(el, shape)
        return mountEmbed(
          el,
          shape,
          (newToolId) => handle.change(doc => { doc.shapes[shape.id].toolId = newToolId }),
          (newDocUrl) => handle.change(doc => { doc.shapes[shape.id].docUrl = newDocUrl }),
          options.getTools,
          repo
        )
      })

    this.shapeTree = createShapeTree(this.shapesEl, mountContent)

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
      createChildDoc:     (datatypeId) => options.createChildDoc(datatypeId),
      getDatatypeId:      () => this.selectedDatatypeId,
      getPlacePreviewEl:  () => this.placePreviewEl,
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
      if (isInsidePatchworkView(e)) return
      // Middle click or space+any button → pan
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

      canvas.setPointerCapture(e.pointerId)
      this.activePointerId = e.pointerId
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
      // the shape once known. getTools returns tools ordered by preference;
      // we pick the first one, mirroring getDefaultToolId in EmbedShapeTool.
      if (this.options.getTools) {
        docUrls.forEach((docUrl, i) => {
          const id = ids[i]
          this.options.getTools!(docUrl)
            .then(tools => {
              const toolId = tools[0]?.id ?? ''
              if (toolId) {
                this.handle.change(doc => {
                  if (doc.shapes[id]) doc.shapes[id].toolId = toolId
                })
              }
            })
            .catch(() => { /* leave toolId as '' — patchwork-view picks its own default */ })
        })
      }
    }

    canvas.addEventListener('pointerdown',  onPointerDown)
    canvas.addEventListener('pointermove',  onPointerMove)
    canvas.addEventListener('pointerup',    onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('wheel',        onWheel as EventListener, { passive: false })
    canvas.addEventListener('dragover',     onDragOver)
    canvas.addEventListener('drop',         onDrop)
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
    this.selectedIds = ids
    this.shapeTree.syncSelection(ids)
    this.refreshHandles()
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
    if (this.selectedIds.size === 0) return

    const shapes = [...this.selectedIds]
      .map(id => {
        const base = this.doc.shapes[id]
        if (!base) return undefined
        const ov = overrides?.get(id)
        return ov ? { ...base, ...ov } : base
      })
      .filter((s): s is CanvasShape => s != null)

    if (shapes.length === 0) return

    // Compute bounding box of all selected shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of shapes) {
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x + s.width)
      maxY = Math.max(maxY, s.y + s.height)
    }

    const box = document.createElement('div')
    box.className = 'sc-selection-box'
    box.style.cssText = `left:${minX}px;top:${minY}px;width:${maxX-minX}px;height:${maxY-minY}px;`
    this.handlesEl.appendChild(box)

    // Resize handles only for single selection, and not for token shapes
    if (this.selectedIds.size !== 1) return
    const s = shapes[0]
    if (s.shapeType === 'token') return

    const screenW = s.width * this.camera.zoom
    const screenH = s.height * this.camera.zoom
    const showCorners = Math.min(screenW, screenH) > 20
    const showEdges   = Math.min(screenW, screenH) > 24

    const HANDLE = 8 / this.camera.zoom
    // Double hit area on mobile-sized viewports for finger-sized targets
    const isMobile = this.screenBounds.width < 768
    const HIT = (isMobile ? 32 : 16) / this.camera.zoom

    const corners = showCorners ? [
      { corner: 'nw', lx: s.x,            ly: s.y },
      { corner: 'ne', lx: s.x + s.width,  ly: s.y },
      { corner: 'se', lx: s.x + s.width,  ly: s.y + s.height },
      { corner: 'sw', lx: s.x,            ly: s.y + s.height },
    ] : []

    const edges = showEdges ? [
      { edge: 'n', lx: s.x + s.width/2, ly: s.y },
      { edge: 'e', lx: s.x + s.width,   ly: s.y + s.height/2 },
      { edge: 's', lx: s.x + s.width/2, ly: s.y + s.height },
      { edge: 'w', lx: s.x,             ly: s.y + s.height/2 },
    ] : []

    for (const h of [...corners, ...edges]) {
      const el = document.createElement('div')
      el.className = 'sc-handle'
      if ('corner' in h) el.dataset.corner = h.corner as string
      if ('edge'   in h) el.dataset.edge   = h.edge   as string
      el.style.cssText = [
        `left:${h.lx - HIT/2}px`,
        `top:${h.ly - HIT/2}px`,
        `width:${HIT}px`,
        `height:${HIT}px`,
        'pointer-events:auto',
        'position:absolute',
      ].join(';')

      const vis = document.createElement('div')
      vis.className = 'sc-handle-visual'
      vis.style.cssText = [
        `left:${(HIT-HANDLE)/2}px`,
        `top:${(HIT-HANDLE)/2}px`,
        `width:${HANDLE}px`,
        `height:${HANDLE}px`,
      ].join(';')
      el.appendChild(vis)
      this.handlesEl.appendChild(el)
    }
  }

  // -------------------------------------------------------------------------
  // Toolbar
  // -------------------------------------------------------------------------

  private datatypeSelect: HTMLSelectElement | null = null

  private buildToolbar() {
    const buttons: { tool: ActiveTool; label: string; title: string }[] = [
      { tool: 'select', label: '↖', title: 'Select (V)' },
      { tool: 'place',  label: '□', title: 'Place (R)' },
      { tool: 'pan',    label: '✋', title: 'Pan (H)' },
    ]

    for (const { tool, label, title } of buttons) {
      const btn = document.createElement('button')
      btn.className = 'sc-tool-btn'
      btn.dataset.toolTarget = tool
      btn.textContent = label
      btn.title = title
      btn.addEventListener('click', () => this.setActiveTool(tool))
      this.toolbarEl.appendChild(btn)
    }

    // Datatype picker — only rendered when datatypes are configured
    if (this.options.datatypes && this.options.datatypes.length > 0) {
      const sel = document.createElement('select')
      sel.className = 'sc-datatype-select'
      sel.title = 'Document type to create'

      for (const dt of this.options.datatypes) {
        const opt = document.createElement('option')
        opt.value = dt.id
        opt.textContent = dt.name
        sel.appendChild(opt)
      }

      // Seed the tracked state from the first entry
      this.selectedDatatypeId = this.options.datatypes[0].id

      sel.addEventListener('change', () => {
        this.selectedDatatypeId = sel.value
        // Picking a datatype implicitly activates the place tool
        this.setActiveTool('place')
      })

      sel.style.display = 'none'
      this.datatypeSelect = sel
      this.toolbarEl.appendChild(sel)
    }

    this.updateToolbarActive()
  }

  private updateToolbarActive() {
    const btns = Array.from(this.toolbarEl.querySelectorAll<HTMLElement>('.sc-tool-btn'))
    for (const btn of btns) {
      btn.classList.toggle('active', btn.dataset.toolTarget === this.activeTool)
    }

    // Show the datatype picker only while the place tool is active
    if (this.datatypeSelect) {
      this.datatypeSelect.style.display = this.activeTool === 'place' ? '' : 'none'
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
  style.textContent = canvasCss + shapesCss + handlesCss
  document.head.appendChild(style)
}
