import type { DocHandle } from "@automerge/automerge-repo";
import type { Camera, Rect, CanvasDoc, Disposer, Vec2 } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { updateCamera, zoomCamera } from "./camera.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { ShapeRenderLayer } from "./layers/shapes-layer.js";
import type { SpatialCanvas } from "./canvas.js";
import canvasCss from "./canvas.css?inline";

export default function CanvasView(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  injectStyles();

  const canvas = element as SpatialCanvas;

  const canvasEl = document.createElement("div");
  canvasEl.className = "sc-canvas";

  const layer = document.createElement("div");
  layer.className = "sc-layer";

  canvasEl.appendChild(layer);
  element.appendChild(canvasEl);

  let camera: Camera = updateCamera({ x: 0, y: 0, zoom: 1 }, layer);
  let screenBounds: { width: number; height: number } = { width: 0, height: 0 };

  const initialRect = canvasEl.getBoundingClientRect();
  screenBounds = { width: initialRect.width, height: initialRect.height };

  mountLayers(handle, layer);

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
  // Pointer capture — layout.ts adds relay listeners on top of this
  // ---------------------------------------------------------------------------

  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (isTextUnderPointer(e.clientX, e.clientY, e.target as Element)) return;
    if ((e.target as Element).closest(".sc-panel, .sc-bar")) return;
    canvasEl.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
  };

  // ---------------------------------------------------------------------------
  // Wheel / gesture handling
  // ---------------------------------------------------------------------------

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
    canvasEl.remove();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
