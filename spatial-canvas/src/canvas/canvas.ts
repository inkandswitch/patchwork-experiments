import type { DocHandle } from "@automerge/automerge-repo";
import type { Camera, Rect, CanvasDoc, Disposer, Vec2, FloatingPanel, Bar } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { updateCamera, zoomCamera } from "./camera.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { ShapeRenderLayer } from "./layers/shapes-layer.js";
import canvasCss from "./canvas.css?inline";

/**
 * A PatchworkViewElement augmented with the spatial canvas public API.
 * Cast the root canvas patchwork-view to this type to access canvas methods.
 */
export type SpatialCanvas = PatchworkViewElement & {
  screenToPage(screenX: number, screenY: number): Vec2;
  pageToScreen(x: number, y: number): Vec2;
  shapesAtPoint(screenX: number, screenY: number): { id: string }[];
  shapesOverlapping(screenRect: Rect): { id: string }[];
};

/** Walk up the DOM to find the nearest SpatialCanvasHost by checking .toolId property. */
export function getCanvas(el: Element | null): SpatialCanvas | null {
  let node = el?.parentElement ?? null;
  while (node) {
    if ((node as any).toolId === "spatial-canvas") return node as unknown as SpatialCanvas;
    node = node.parentElement;
  }
  return null;
}

/**
 * SpatialCanvas — the core spatial canvas host.
 *
 * A plain function that mounts its DOM into a PatchworkViewElement and attaches
 * the public API methods directly onto that element so nested tool views can
 * reach them via:
 *
 *   const host = (e.target as Element)
 *     .closest('patchwork-view[data-spatial-canvas]') as SpatialCanvasHost
 *   host.shapesAtPoint(e.clientX, e.clientY)
 */
export default function SpatialCanvas(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  injectStyles();

  const canvas = element as SpatialCanvas;

  const container = document.createElement("div");
  container.className = "sc-container";

  const columnWrapper = document.createElement("div");
  columnWrapper.className = "sc-column-wrapper";

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "sc-canvas-wrapper";

  const canvasEl = document.createElement("div");
  canvasEl.className = "sc-canvas";

  const layer = document.createElement("div");
  layer.className = "sc-layer";

  canvasEl.appendChild(layer);
  canvasWrapper.appendChild(canvasEl);
  columnWrapper.appendChild(canvasWrapper);
  container.appendChild(columnWrapper);
  element.appendChild(container);

  let camera: Camera = updateCamera({ x: 0, y: 0, zoom: 1 }, layer);
  let screenBounds: { width: number; height: number } = { width: 0, height: 0 };

  const initialRect = canvasEl.getBoundingClientRect();
  screenBounds = { width: initialRect.width, height: initialRect.height };

  mountLayers(handle, layer);
  mountLayout(handle, container, columnWrapper, canvasWrapper);

  const shapeLayerEl = document.createElement("div");
  shapeLayerEl.style.cssText = "position:absolute;inset:0;";
  layer.appendChild(shapeLayerEl);
  const shapeRenderLayer = new ShapeRenderLayer(handle, shapeLayerEl, (element as any).repo);

  const ro = new ResizeObserver(() => {
    const rect = canvasEl.getBoundingClientRect();
    screenBounds = { width: rect.width, height: rect.height };
  });
  ro.observe(canvasEl);

  // Sync active tool from doc changes (visual state only)
  let activeTool = "";
  const applyActiveTool = (toolId: string) => {
    activeTool = toolId;
    canvasEl.dataset.tool = toolId;
  };

  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";
  const onDocChange = ({ doc }: { doc: CanvasDoc }) => {
    const tool = doc.stateByUser?.[contactUrl]?.selectedTool;
    if (tool && tool !== activeTool) applyActiveTool(tool);
  };
  handle.on("change", onDocChange);

  const initialTool =
    handle.doc()?.stateByUser?.[contactUrl]?.selectedTool ?? "spatial-canvas-tool-select";
  applyActiveTool(initialTool);

  // ---------------------------------------------------------------------------
  // Public API — attached directly onto the element
  // ---------------------------------------------------------------------------

  canvas.screenToPage = (screenX: number, screenY: number): Vec2 => {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: (screenX - rect.left) / camera.zoom - camera.x,
      y: (screenY - rect.top) / camera.zoom - camera.y,
    };
  };

  canvas.pageToScreen = (x: number, y: number): Vec2 => {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: (x + camera.x) * camera.zoom + rect.left,
      y: (y + camera.y) * camera.zoom + rect.top,
    };
  };

  canvas.shapesAtPoint = (screenX: number, screenY: number) =>
    shapeRenderLayer.shapesAtPoint(screenX, screenY) ?? [];

  canvas.shapesOverlapping = (screenRect: Rect) =>
    shapeRenderLayer.shapesOverlapping(screenRect) ?? [];

  // ---------------------------------------------------------------------------
  // Pointer event relay
  // ---------------------------------------------------------------------------

  let activePointerId: number | null = null;

  const relayPointerEvent = (type: string, e: PointerEvent) => {
    const makeClone = () =>
      new PointerEvent(type, {
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

    const activeBtn = container.querySelector<HTMLElement>(
      `patchwork-view[tool-id="${activeTool}"]`,
    );
    if (activeBtn) activeBtn.dispatchEvent(makeClone());

    for (const panel of orderedPanels(container)) {
      const clone = makeClone();

      let stopped = false;
      const origStop = clone.stopPropagation.bind(clone);
      clone.stopPropagation = () => {
        stopped = true;
        origStop();
      };
      const origStopImmediate = clone.stopImmediatePropagation.bind(clone);
      clone.stopImmediatePropagation = () => {
        stopped = true;
        origStopImmediate();
      };

      panel.dispatchEvent(clone);
      if (stopped) break;
    }
  };

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (isTextUnderPointer(e.clientX, e.clientY, e.target as Element)) return;
    canvasEl.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    relayPointerEvent("pointerdown", e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (activePointerId !== null) relayPointerEvent("pointermove", e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    relayPointerEvent("pointerup", e);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    relayPointerEvent("pointercancel", e);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [rawDx, rawDy] = normalizeDelta(e);
    if (rawDx === 0 && rawDy === 0) return;

    const rect = canvasEl.getBoundingClientRect();

    if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
      const next = zoomCamera(camera, e.clientX - rect.left, e.clientY - rect.top, rawDy);
      camera = updateCamera(next, layer);
    } else {
      const dx = e.shiftKey ? rawDy : rawDx;
      const dy = e.shiftKey ? 0 : rawDy;
      const next: Camera = {
        ...camera,
        x: camera.x - dx / camera.zoom,
        y: camera.y - dy / camera.zoom,
      };
      camera = updateCamera(next, layer);
    }
    shapeRenderLayer.notifyCameraChanged();
  };

  const preventGesture = (e: Event) => e.preventDefault();

  const preventEdgeSwipe = (e: TouchEvent) => {
    const x = e.touches[0].pageX;
    const r = e.touches[0].radiusX || 0;
    if (x - r < 10 || x + r > screenBounds.width - 10) e.preventDefault();
  };

  canvasEl.addEventListener("pointerdown", onPointerDown);
  canvasEl.addEventListener("pointermove", onPointerMove);
  canvasEl.addEventListener("pointerup", onPointerUp);
  canvasEl.addEventListener("pointercancel", onPointerCancel);
  canvasEl.addEventListener("wheel", onWheel as EventListener, { passive: false });
  // @ts-ignore — gesturestart/gesturechange/gestureend are WebKit-proprietary
  document.addEventListener("gesturestart", preventGesture);
  // @ts-ignore
  document.addEventListener("gesturechange", preventGesture);
  // @ts-ignore
  canvasEl.addEventListener("gestureend", preventGesture);
  canvasEl.addEventListener("touchstart", preventEdgeSwipe, { passive: false });

  return () => {
    handle.off("change", onDocChange);
    ro.disconnect();
    shapeRenderLayer.dispose();
    canvasEl.removeEventListener("pointerdown", onPointerDown);
    canvasEl.removeEventListener("pointermove", onPointerMove);
    canvasEl.removeEventListener("pointerup", onPointerUp);
    canvasEl.removeEventListener("pointercancel", onPointerCancel);
    canvasEl.removeEventListener("wheel", onWheel as EventListener);
    // @ts-ignore
    document.removeEventListener("gesturestart", preventGesture);
    // @ts-ignore
    document.removeEventListener("gesturechange", preventGesture);
    // @ts-ignore
    canvasEl.removeEventListener("gestureend", preventGesture);
    canvasEl.removeEventListener("touchstart", preventEdgeSwipe);
    delete (canvas as any).screenToPage;
    delete (canvas as any).pageToScreen;
    delete (canvas as any).shapesAtPoint;
    delete (canvas as any).shapesOverlapping;
    delete (canvas as any).relayKeyboardEvent;
    container.remove();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orderedPanels(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".sc-panel, .sc-bar"));
}

function mountLayers(handle: DocHandle<CanvasDoc>, layer: HTMLElement) {
  const registry = getRegistry("patchwork:tool");
  const layerDescs = registry.filter(
    (p) => !!(p.tags as string[] | undefined)?.includes("spatial-canvas-layer"),
  );

  for (const desc of layerDescs) {
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", handle.url);
    view.setAttribute("tool-id", desc.id);
    view.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    layer.appendChild(view);
  }
}

function mountLayout(
  handle: DocHandle<CanvasDoc>,
  container: HTMLElement,
  columnWrapper: HTMLElement,
  canvasWrapper: HTMLElement,
) {
  const doc = handle.doc();
  if (!doc?.layout) return;

  const panelEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "panel") as [
    string,
    FloatingPanel,
  ][];

  if (panelEntries.length > 0) {
    const overlay = document.createElement("div");
    overlay.className = "sc-panel-overlay";
    canvasWrapper.appendChild(overlay);

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

  const barEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "bar") as [
    string,
    Bar,
  ][];

  for (const [toolId, entry] of barEntries) {
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", handle.url);
    view.setAttribute("tool-id", toolId);
    view.className = `sc-bar sc-bar--${entry.side}`;

    if (entry.side === "left") {
      container.insertBefore(view, columnWrapper);
    } else if (entry.side === "right") {
      container.appendChild(view);
    } else if (entry.side === "top") {
      columnWrapper.insertBefore(view, canvasWrapper);
    } else {
      columnWrapper.appendChild(view);
    }
  }
}

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
    if ((node as HTMLElement).isContentEditable) {
      insideEditable = true;
      break;
    }
    node = node.parentElement;
  }
  if (!insideEditable) return false;

  try {
    const charRange = document.createRange();
    charRange.setStart(textNode, charOffset);
    charRange.setEnd(textNode, Math.min(charOffset + 1, textNode.length));
    const rect = charRange.getBoundingClientRect();
    const SLOP = 2;
    return (
      rect.width > 0 &&
      x >= rect.left - SLOP &&
      x <= rect.right + SLOP &&
      y >= rect.top - SLOP &&
      y <= rect.bottom + SLOP
    );
  } catch {
    return false;
  }
};

let stylesInjected = false;

const injectStyles = () => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = canvasCss;
  document.head.appendChild(style);
};
