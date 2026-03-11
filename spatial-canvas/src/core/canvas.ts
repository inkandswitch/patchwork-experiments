import type { Camera, Rect, CanvasDoc, DocHandle, Disposer } from "./types.js";
import { updateCamera, zoomCamera } from "./camera.js";
import { Inputs } from "./inputs.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

import canvasCss from "./css/canvas.css?inline";

/**
 * Normalize WheelEvent delta to pixels regardless of deltaMode.
 * deltaMode 0 = pixels (pass through), 1 = lines (~17px), 2 = pages (~400px).
 */
function normalizeDelta(e: WheelEvent): [number, number] {
  const factor = e.deltaMode === 1 ? 17 : e.deltaMode === 2 ? 400 : 1;
  return [e.deltaX * factor, e.deltaY * factor];
}

/**
 * CanvasView — the core spatial canvas host.
 *
 * Responsibilities:
 *  - Build the DOM scaffold (container, canvas, layer, panel overlay)
 *  - Own the camera (wheel zoom + scroll pan)
 *  - Discover panel plugins from the patchwork registry (tag: spatial-canvas-panel)
 *    and mount them into the 3×3 grid overlay at positions read from doc.panels
 *  - Discover render layers from the registry (tag: spatial-canvas-layer)
 *    and mount each layer into the transform layer
 *  - Dispatch spatial-canvas:pointer* CustomEvents to the active tool's button
 *  - Listen for spatial-canvas:set-tool events and dispatch spatial-canvas:tool-changed
 */
export class CanvasView {
  private container: HTMLElement;
  private canvasEl: HTMLElement;
  private layer: HTMLElement;

  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private screenBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private activeTool: string = "";
  private activePointerId: number | null = null;
  private repo: unknown = undefined;

  private inputs = new Inputs();
  private disposers: Disposer[] = [];

  constructor(
    private handle: DocHandle<CanvasDoc>,
    mountPoint: HTMLElement,
  ) {
    this.repo = (mountPoint as any).repo;
    injectStyles();

    // Build DOM scaffold
    this.container = document.createElement("div");
    this.container.className = "sc-container";

    this.canvasEl = document.createElement("div");
    this.canvasEl.className = "sc-canvas";

    this.layer = document.createElement("div");
    this.layer.className = "sc-layer";

    this.canvasEl.appendChild(this.layer);
    this.container.appendChild(this.canvasEl);
    mountPoint.appendChild(this.container);

    // Seed bounds immediately after mounting so the first coordinate
    // transforms use real dimensions rather than {0,0,0,0}.
    const initialRect = this.canvasEl.getBoundingClientRect();
    this.inputs.updateBounds(initialRect);
    this.screenBounds = { x: 0, y: 0, width: initialRect.width, height: initialRect.height };

    // Initialize camera (writes CSS variables to DOM)
    this.camera = updateCamera({ x: 0, y: 0, zoom: 1 }, this.container, this.layer, (cam) => {
      this.camera = cam;
    });

    // Mount layers and panels from the patchwork registry
    this.mountLayers();
    this.mountPanels();

    // ResizeObserver — keeps coordinate transforms correct when the canvas resizes
    const ro = new ResizeObserver(() => {
      const rect = this.canvasEl.getBoundingClientRect();
      this.inputs.updateBounds(rect);
      this.screenBounds = { x: 0, y: 0, width: rect.width, height: rect.height };
    });
    ro.observe(this.canvasEl);
    this.disposers.push(() => ro.disconnect());

    this.bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  private bindEvents() {
    const canvas = this.canvasEl;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
      this.dispatchToActiveTool("spatial-canvas:pointerdown", e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
      if (this.activePointerId !== null) {
        this.dispatchToActiveTool("spatial-canvas:pointermove", e);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      this.activePointerId = null;
      this.dispatchToActiveTool("spatial-canvas:pointerup", e);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      this.activePointerId = null;
      const btn = this.container.querySelector<HTMLElement>(`patchwork-view[tool-id="${this.activeTool}"]`);
      btn?.dispatchEvent(new CustomEvent("spatial-canvas:cancel", { bubbles: false }));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [rawDx, rawDy] = normalizeDelta(e);
      if (rawDx === 0 && rawDy === 0) return;

      if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
        // Zoom — ctrl+scroll or trackpad pinch-to-zoom (ctrlKey=true)
        const rect = this.inputs.bounds;
        const next = zoomCamera(this.camera, e.clientX - rect.left, e.clientY - rect.top, rawDy);
        this.camera = updateCamera(next, this.container, this.layer, (cam) => {
          this.camera = cam;
        });
      } else {
        // Pan — trackpads produce X+Y deltas, mice produce Y only
        const dx = e.shiftKey ? rawDy : rawDx;
        const dy = e.shiftKey ? 0 : rawDy;
        const next: Camera = {
          ...this.camera,
          x: this.camera.x - dx / this.camera.zoom,
          y: this.camera.y - dy / this.camera.zoom,
        };
        this.camera = updateCamera(next, this.container, this.layer, (cam) => {
          this.camera = cam;
        });
      }
    };

    // iOS Safari: prevent proprietary gesture events from triggering native zoom
    const preventGesture = (e: Event) => e.preventDefault();

    // iOS edge-swipe navigation prevention
    const preventEdgeSwipe = (e: TouchEvent) => {
      const x = e.touches[0].pageX;
      const r = e.touches[0].radiusX || 0;
      if (x - r < 10 || x + r > this.screenBounds.width - 10) {
        e.preventDefault();
      }
    };

    // Tool selection via custom events (panel plugins dispatch these)
    const onSetTool = (e: Event) => {
      this.setActiveTool((e as CustomEvent<{ toolId: string }>).detail.toolId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel as EventListener, { passive: false });
    // @ts-ignore — gesturestart/gesturechange/gestureend are WebKit-proprietary
    document.addEventListener("gesturestart", preventGesture);
    // @ts-ignore
    document.addEventListener("gesturechange", preventGesture);
    // @ts-ignore
    canvas.addEventListener("gestureend", preventGesture);
    canvas.addEventListener("touchstart", preventEdgeSwipe, { passive: false });
    this.container.addEventListener("spatial-canvas:set-tool", onSetTool);

    this.disposers.push(() => {
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
      this.container.removeEventListener("spatial-canvas:set-tool", onSetTool);
    });
  }

  // ---------------------------------------------------------------------------
  // Active tool dispatch
  // ---------------------------------------------------------------------------

  private dispatchToActiveTool(type: string, e: PointerEvent) {
    const btn = this.container.querySelector<HTMLElement>(`patchwork-view[tool-id="${this.activeTool}"]`);
    if (!btn) return;
    const page = this.inputs.screenToPage(e.clientX, e.clientY, this.camera);
    btn.dispatchEvent(
      new CustomEvent(type, {
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
      }),
    );
  }

  setActiveTool(tool: string) {
    const oldBtn = this.container.querySelector<HTMLElement>(`patchwork-view[tool-id="${this.activeTool}"]`);
    oldBtn?.dispatchEvent(new CustomEvent("spatial-canvas:cancel", { bubbles: false }));
    this.activeTool = tool;
    this.canvasEl.dataset.tool = tool;
    // Notify all toolbar panels so they can update active button state
    this.container.dispatchEvent(
      new CustomEvent("spatial-canvas:tool-changed", {
        detail: { toolId: tool },
        bubbles: false,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Layers — discovered from the patchwork registry by tag
  // ---------------------------------------------------------------------------

  private mountLayers() {
    const registry = getRegistry("patchwork:tool");
    const layerDescs = registry.filter((p) => !!(p.tags as string[] | undefined)?.includes("spatial-canvas-layer"));

    for (const desc of layerDescs) {
      const div = document.createElement("div");
      // No z-index on the container — a positioned element with z-index:auto
      // does NOT form a new stacking context, so elements rendered by different
      // layers interleave freely via their own shape.zIndex values.
      div.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      this.layer.appendChild(div);

      registry.load(desc.id).then((loaded) => {
        if (!loaded) return;
        const dispose = (loaded.module as (h: DocHandle<CanvasDoc>, el: HTMLElement) => Disposer)(this.handle, div);
        this.disposers.push(dispose);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Panels — 3×3 grid overlay, positions read from doc.panels
  // ---------------------------------------------------------------------------

  private mountPanels() {
    const doc = this.handle.doc();
    if (!doc?.panels) return;

    const registry = getRegistry("patchwork:tool");

    // Build the 3×3 grid overlay
    const overlay = document.createElement("div");
    overlay.className = "sc-panel-overlay";
    this.container.appendChild(overlay);

    // Normalize directional align names → CSS group modifier names
    function toAlignClass(align: string): "start" | "center" | "end" {
      if (align === "right" || align === "bottom") return "end";
      if (align === "center") return "center";
      return "start";
    }

    // Group panel IDs by side, then by normalized align
    type Side = "top" | "bottom" | "left" | "right";
    type Align = "start" | "center" | "end";
    const grouped = new Map<Side, Map<Align, string[]>>();

    for (const [panelId, entry] of Object.entries(doc.panels)) {
      const [side, rawAlign] = entry.position;
      const align = toAlignClass(rawAlign);
      if (!grouped.has(side)) grouped.set(side, new Map());
      const sideMap = grouped.get(side)!;
      if (!sideMap.has(align)) sideMap.set(align, []);
      sideMap.get(align)!.push(panelId);
    }

    for (const [side, alignMap] of grouped) {
      const sideEl = document.createElement("div");
      sideEl.className = `sc-side sc-side--${side}`;
      overlay.appendChild(sideEl);

      for (const [align, panelIds] of alignMap) {
        const groupEl = document.createElement("div");
        groupEl.className = `sc-side-group sc-side-group--${align}`;
        sideEl.appendChild(groupEl);

        for (const panelId of panelIds) {
          const panelEl = document.createElement("div");
          panelEl.className = "sc-panel";
          groupEl.appendChild(panelEl);

          registry.load(panelId).then((loaded) => {
            if (!loaded) return;
            const dispose = (loaded.module as (h: DocHandle<CanvasDoc>, el: HTMLElement, repo: unknown) => Disposer)(this.handle, panelEl, this.repo);
            this.disposers.push(dispose);
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    for (const d of this.disposers) d();
    this.container.remove();
  }
}

// ---------------------------------------------------------------------------
// Style injection (once per document)
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = canvasCss;
  document.head.appendChild(style);
}
