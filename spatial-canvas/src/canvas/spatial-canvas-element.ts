import type { DocHandle } from "@automerge/automerge-repo";
import type { Camera, Rect, CanvasDoc, Disposer, Vec2 } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { updateCamera, zoomCamera } from "./camera.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { ShapeRenderLayer } from "./layers/shape-render-layer.js";
import canvasCss from "./canvas.css?inline";

/**
 * SpatialCanvas — the core spatial canvas host.
 *
 * A plain class (not a custom element) that mounts its DOM into a
 * PatchworkViewElement. An instance is stored on the root patchwork-view as
 * `element.spatialCanvas` so nested tool views can reach it via:
 *
 *   const host = (e.target as Element)
 *     .closest('patchwork-view[tool-id="spatial-canvas"]') as SpatialCanvasHost
 *   host.spatialCanvas.shapesAtPoint(e.clientX, e.clientY)
 */
export class SpatialCanvasElement {
  #handle: DocHandle<CanvasDoc> | null = null;
  #container!: HTMLElement;
  #columnWrapper!: HTMLElement;
  #canvasWrapper!: HTMLElement;
  #canvasEl!: HTMLElement;
  #layer!: HTMLElement;

  #camera: Camera = { x: 0, y: 0, zoom: 1 };
  #screenBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #activeTool: string = "";
  #activePointerId: number | null = null;
  #shapeRenderLayer: ShapeRenderLayer | null = null;

  #disposers: Disposer[] = [];

  init(handle: DocHandle<CanvasDoc>, mountPoint: PatchworkViewElement) {
    this.#handle = handle;
    injectStyles();

    this.#container = document.createElement("div");
    this.#container.className = "sc-container";

    this.#columnWrapper = document.createElement("div");
    this.#columnWrapper.className = "sc-column-wrapper";

    this.#canvasWrapper = document.createElement("div");
    this.#canvasWrapper.className = "sc-canvas-wrapper";

    this.#canvasEl = document.createElement("div");
    this.#canvasEl.className = "sc-canvas";

    this.#layer = document.createElement("div");
    this.#layer.className = "sc-layer";

    this.#canvasEl.appendChild(this.#layer);
    this.#canvasWrapper.appendChild(this.#canvasEl);
    this.#columnWrapper.appendChild(this.#canvasWrapper);
    this.#container.appendChild(this.#columnWrapper);
    mountPoint.appendChild(this.#container);

    const initialRect = this.#canvasEl.getBoundingClientRect();
    this.#screenBounds = { x: 0, y: 0, width: initialRect.width, height: initialRect.height };

    this.#camera = updateCamera({ x: 0, y: 0, zoom: 1 }, this.#layer);

    this.#mountLayers(handle);
    this.#mountLayout(handle);

    // Instantiate the shape render layer directly so we have a reference for
    // hit-test and culling. It manages its own <patchwork-ref-view> elements.
    const shapeLayerEl = document.createElement("div");
    shapeLayerEl.style.cssText = "position:absolute;inset:0;";
    this.#layer.appendChild(shapeLayerEl);
    this.#shapeRenderLayer = new ShapeRenderLayer(handle, shapeLayerEl, (mountPoint as any).repo);
    this.#disposers.push(() => this.#shapeRenderLayer?.dispose());

    const ro = new ResizeObserver(() => {
      const rect = this.#canvasEl.getBoundingClientRect();
      this.#screenBounds = { x: 0, y: 0, width: rect.width, height: rect.height };
    });
    ro.observe(this.#canvasEl);
    this.#disposers.push(() => ro.disconnect());

    this.#bindEvents();

    // Sync active tool from remote doc changes
    const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";
    const onDocChange = ({ doc }: { doc: CanvasDoc }) => {
      const tool = doc.stateByUser?.[contactUrl]?.selectedTool;
      if (tool && tool !== this.#activeTool) this.#applyActiveTool(tool);
    };
    handle.on("change", onDocChange);
    this.#disposers.push(() => handle.off("change", onDocChange));

    const initialTool = handle.doc()?.stateByUser?.[contactUrl]?.selectedTool ?? "spatial-canvas-tool-select";
    this.#applyActiveTool(initialTool);
  }

  // ---------------------------------------------------------------------------
  // Public coordinate conversion methods
  // ---------------------------------------------------------------------------

  /** Convert screen-space (clientX/Y) to canvas/page coordinates. */
  screenToPage(screenX: number, screenY: number): Vec2 {
    const rect = this.#canvasEl.getBoundingClientRect();
    return {
      x: (screenX - rect.left) / this.#camera.zoom - this.#camera.x,
      y: (screenY - rect.top) / this.#camera.zoom - this.#camera.y,
    };
  }

  /** Convert canvas/page coordinates to screen-space (clientX/Y). */
  pageToScreen(x: number, y: number): Vec2 {
    const rect = this.#canvasEl.getBoundingClientRect();
    return {
      x: (x + this.#camera.x) * this.#camera.zoom + rect.left,
      y: (y + this.#camera.y) * this.#camera.zoom + rect.top,
    };
  }

  /** Returns shapes whose DOM element is at the given screen point.
   *  Results are ordered top-to-bottom by DOM stacking order. */
  shapesAtPoint(screenX: number, screenY: number) {
    return this.#shapeRenderLayer?.shapesAtPoint(screenX, screenY) ?? [];
  }

  /** Returns shapes whose bounding rect intersects the given screen-space rect. */
  shapesOverlapping(screenRect: Rect) {
    return this.#shapeRenderLayer?.shapesOverlapping(screenRect) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Public event relay
  // ---------------------------------------------------------------------------

  /**
   * Relay a KeyboardEvent through all panels in DOM order.
   * Each panel receives a cloned KeyboardEvent. A panel can call
   * stopPropagation() to consume it and stop further relay.
   */
  relayKeyboardEvent(e: KeyboardEvent) {
    let consumed = false;
    for (const panel of this.#orderedPanels()) {
      const clone = new KeyboardEvent(e.type, {
        bubbles: true,
        cancelable: e.cancelable,
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        charCode: e.charCode,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        repeat: e.repeat,
      });
      (clone as any)._scRelayed = true;

      let stopped = false;
      const origStop = clone.stopPropagation.bind(clone);
      clone.stopPropagation = () => { stopped = true; origStop(); };
      const origStopImmediate = clone.stopImmediatePropagation.bind(clone);
      clone.stopImmediatePropagation = () => { stopped = true; origStopImmediate(); };

      panel.dispatchEvent(clone);
      if (stopped) { consumed = true; break; }
    }
    if (consumed) e.preventDefault();
  }

  dispose() {
    for (const d of this.#disposers) d();
    this.#container.remove();
  }
  // ---------------------------------------------------------------------------
  // Private: active tool (visual state only, no doc write)
  // ---------------------------------------------------------------------------

  #applyActiveTool(toolId: string) {
    this.#activeTool = toolId;
    this.#canvasEl.dataset.tool = toolId;
  }

  // ---------------------------------------------------------------------------
  // Pointer event relay
  // ---------------------------------------------------------------------------

  #relayPointerEvent(type: string, e: PointerEvent) {
    const makeClone = () => new PointerEvent(type, {
      bubbles: true,
      cancelable: e.cancelable,
      clientX: e.clientX,
      clientY: e.clientY,
      movementX: e.movementX,
      movementY: e.movementY,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      pressure: e.pressure,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
    });

    // Dispatch to the active tool button directly (primary path for tools)
    const activeBtn = this.#container.querySelector<HTMLElement>(`patchwork-view[tool-id="${this.#activeTool}"]`);
    if (activeBtn) {
      activeBtn.dispatchEvent(makeClone());
    }

    // Also relay through panels (for panels that want to intercept all events)
    for (const panel of this.#orderedPanels()) {
      const clone = makeClone();

      let stopped = false;
      const origStop = clone.stopPropagation.bind(clone);
      clone.stopPropagation = () => { stopped = true; origStop(); };
      const origStopImmediate = clone.stopImmediatePropagation.bind(clone);
      clone.stopImmediatePropagation = () => { stopped = true; origStopImmediate(); };

      panel.dispatchEvent(clone);
      if (stopped) break;
    }
  }

  #orderedPanels(): HTMLElement[] {
    return Array.from(this.#container.querySelectorAll<HTMLElement>(".sc-panel, .sc-bar"));
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  #bindEvents() {
    const canvas = this.#canvasEl;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (isTextUnderPointer(e.clientX, e.clientY, e.target as Element)) return;
      canvas.setPointerCapture(e.pointerId);
      this.#activePointerId = e.pointerId;
      this.#relayPointerEvent("pointerdown", e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.#activePointerId !== null && e.pointerId !== this.#activePointerId) return;
      if (this.#activePointerId !== null) {
        this.#relayPointerEvent("pointermove", e);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.#activePointerId) return;
      this.#activePointerId = null;
      this.#relayPointerEvent("pointerup", e);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== this.#activePointerId) return;
      this.#activePointerId = null;
      this.#relayPointerEvent("pointercancel", e);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [rawDx, rawDy] = normalizeDelta(e);
      if (rawDx === 0 && rawDy === 0) return;

      const rect = this.#canvasEl.getBoundingClientRect();

      if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
        const next = zoomCamera(this.#camera, e.clientX - rect.left, e.clientY - rect.top, rawDy);
        this.#camera = updateCamera(next, this.#layer);
      } else {
        const dx = e.shiftKey ? rawDy : rawDx;
        const dy = e.shiftKey ? 0 : rawDy;
        const next: Camera = {
          ...this.#camera,
          x: this.#camera.x - dx / this.#camera.zoom,
          y: this.#camera.y - dy / this.#camera.zoom,
        };
        this.#camera = updateCamera(next, this.#layer);
      }
      this.#shapeRenderLayer?.notifyCameraChanged();
    };

    const preventGesture = (e: Event) => e.preventDefault();

    const preventEdgeSwipe = (e: TouchEvent) => {
      const x = e.touches[0].pageX;
      const r = e.touches[0].radiusX || 0;
      if (x - r < 10 || x + r > this.#screenBounds.width - 10) e.preventDefault();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel as EventListener, { passive: false });
    // @ts-ignore
    document.addEventListener("gesturestart", preventGesture);
    // @ts-ignore
    document.addEventListener("gesturechange", preventGesture);
    // @ts-ignore
    canvas.addEventListener("gestureend", preventGesture);
    canvas.addEventListener("touchstart", preventEdgeSwipe, { passive: false });

    this.#disposers.push(() => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel as EventListener);
      // @ts-ignore
      document.removeEventListener("gesturestart", preventGesture);
      // @ts-ignore
      document.removeEventListener("gesturechange", preventGesture);
      // @ts-ignore
      canvas.removeEventListener("gestureend", preventGesture);
      canvas.removeEventListener("touchstart", preventEdgeSwipe);
    });
  }

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------

  #mountLayers(handle: DocHandle<CanvasDoc>) {
    const registry = getRegistry("patchwork:tool");
    const layerDescs = registry.filter((p) => !!(p.tags as string[] | undefined)?.includes("spatial-canvas-layer"));

    for (const desc of layerDescs) {
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", handle.url);
      view.setAttribute("tool-id", desc.id);
      view.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      this.#layer.appendChild(view);
    }
  }

  // ---------------------------------------------------------------------------
  // Layout (panels + bars)
  // ---------------------------------------------------------------------------

  #mountLayout(handle: DocHandle<CanvasDoc>) {
    const doc = handle.doc();
    if (!doc?.layout) return;

    const panelEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "panel") as
      [string, import("./types.js").FloatingPanel][];

    if (panelEntries.length > 0) {
      const overlay = document.createElement("div");
      overlay.className = "sc-panel-overlay";
      this.#canvasWrapper.appendChild(overlay);

      type Side = "top" | "bottom" | "left" | "right";
      type Align = "start" | "center" | "end";
      const grouped = new Map<Side, Map<Align, string[]>>();

      for (const [toolId, entry] of panelEntries) {
        const [side, align] = entry.position;
        const normAlign = toAlignClass(align);
        if (!grouped.has(side)) grouped.set(side, new Map());
        const sideMap = grouped.get(side)!;
        if (!sideMap.has(normAlign)) sideMap.set(normAlign, []);
        sideMap.get(normAlign)!.push(toolId);
      }

      for (const [side, alignMap] of grouped) {
        const sideEl = document.createElement("div");
        sideEl.className = `sc-side sc-side--${side}`;
        overlay.appendChild(sideEl);

        for (const [align, toolIds] of alignMap) {
          const groupEl = document.createElement("div");
          groupEl.className = `sc-side-group sc-side-group--${align}`;
          sideEl.appendChild(groupEl);

          for (const toolId of toolIds) {
            const view = document.createElement("patchwork-view");
            view.setAttribute("doc-url", handle.url);
            view.setAttribute("tool-id", toolId);
            view.className = "sc-panel";
            groupEl.appendChild(view);
          }
        }
      }
    }

    const barEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "bar") as
      [string, import("./types.js").Bar][];

    for (const [toolId, entry] of barEntries) {
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", handle.url);
      view.setAttribute("tool-id", toolId);
      view.className = `sc-bar sc-bar--${entry.side}`;

      if (entry.side === "left") {
        this.#container.insertBefore(view, this.#columnWrapper);
      } else if (entry.side === "right") {
        this.#container.appendChild(view);
      } else if (entry.side === "top") {
        this.#columnWrapper.insertBefore(view, this.#canvasWrapper);
      } else {
        this.#columnWrapper.appendChild(view);
      }
    }
  }
}

if (!customElements.get("spatial-canvas")) {
  customElements.define("spatial-canvas", SpatialCanvasElement);
}

/**
 * A PatchworkViewElement augmented with a spatialCanvas instance.
 * Cast the root canvas patchwork-view to this type to access canvas methods.
 */
export type SpatialCanvasHost = PatchworkViewElement & { spatialCanvas: SpatialCanvasElement }

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

let stylesInjected = false;

const injectStyles = () => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = canvasCss;
  document.head.appendChild(style);
};

const toAlignClass = (align: string): "start" | "center" | "end" => {
  if (align === "right" || align === "bottom") return "end";
  if (align === "center") return "center";
  return "start";
};

const normalizeDelta = (e: WheelEvent): [number, number] => {
  const factor = e.deltaMode === 1 ? 17 : e.deltaMode === 2 ? 400 : 1;
  return [e.deltaX * factor, e.deltaY * factor];
};

const isTextUnderPointer = (x: number, y: number, target: Element | null): boolean => {
  let el: Element | null = target;
  while (el && !el.classList.contains("sc-canvas")) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return true;
    el = el.parentElement;
  }

  let textNode: Text | null = null;
  let charOffset = 0;

  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r?.startContainer.nodeType === Node.TEXT_NODE) {
      textNode = r.startContainer as Text;
      charOffset = r.startOffset;
    }
  } else if ((document as any).caretPositionFromPoint) {
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos?.offsetNode?.nodeType === Node.TEXT_NODE) {
      textNode = pos.offsetNode as Text;
      charOffset = pos.offset as number;
    }
  }

  if (!textNode) return false;

  let node: Element | null = textNode.parentElement;
  let insideEditable = false;
  while (node && !node.classList.contains("sc-canvas")) {
    if ((node as HTMLElement).isContentEditable) { insideEditable = true; break; }
    node = node.parentElement;
  }
  if (!insideEditable) return false;

  try {
    const charRange = document.createRange();
    charRange.setStart(textNode, charOffset);
    charRange.setEnd(textNode, Math.min(charOffset + 1, textNode.length));
    const rect = charRange.getBoundingClientRect();
    const SLOP = 2;
    return rect.width > 0 && x >= rect.left - SLOP && x <= rect.right + SLOP && y >= rect.top - SLOP && y <= rect.bottom + SLOP;
  } catch {
    return false;
  }
};
