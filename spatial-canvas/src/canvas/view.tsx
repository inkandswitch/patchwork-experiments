import type { DocHandle } from "@automerge/automerge-repo";
import type { Camera, CanvasDoc, Disposer, Rect, Vec2 } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { For, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";
import { clampZoom, zoomCamera } from "./camera.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { ShapeRenderLayer, type ShapeLayerAPI } from "./shape-layer.js";
import type { SpatialCanvas } from "./canvas.js";
import canvasCss from "./canvas.css?inline";

export default function CanvasView(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  injectStyles();
  return render(() => <CanvasViewUI handle={handle} canvas={element as SpatialCanvas} />, element);
}

type Props = {
  handle: DocHandle<CanvasDoc>;
  canvas: SpatialCanvas;
};

function CanvasViewUI(props: Props) {
  const doc = makeDocumentProjection(props.handle);
  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";

  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let cameraTransform = cameraToTransform(camera);
  let layerEl!: HTMLDivElement;
  let canvasEl!: HTMLDivElement;
  let shapeLayer!: ShapeLayerAPI;
  let screenBounds = { width: 0, height: 0 };
  let activePointerId: number | null = null;

  const activeTool = () =>
    doc.stateByUser?.[contactUrl]?.selectedTool ?? "spatial-canvas-tool-select";

  const layerPlugins = getRegistry("patchwork:tool").filter(
    (p) => !!(p.tags as string[] | undefined)?.includes("spatial-canvas-layer"),
  );

  // ---------------------------------------------------------------------------
  // Public API — attached onto the canvas element
  // ---------------------------------------------------------------------------

  const canvas = props.canvas;

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
    shapeLayer?.shapesAtPoint(screenX, screenY) ?? [];

  canvas.shapesOverlapping = (screenRect: Rect) =>
    shapeLayer?.shapesOverlapping(screenRect) ?? [];

  onCleanup(() => {
    delete (canvas as any).screenToPage;
    delete (canvas as any).pageToScreen;
    delete (canvas as any).shapesAtPoint;
    delete (canvas as any).shapesOverlapping;
  });

  // ---------------------------------------------------------------------------
  // Camera — kept as a plain mutable value; transform string applied via ref
  // ---------------------------------------------------------------------------

  function applyCamera(next: Camera) {
    camera = { ...next, zoom: clampZoom(next.zoom) };
    cameraTransform = cameraToTransform(camera);
    if (layerEl) layerEl.style.transform = cameraTransform;
    shapeLayer?.notifyCameraChanged();
  }

  // ---------------------------------------------------------------------------
  // Event listeners (attached in onMount so refs are resolved)
  // ---------------------------------------------------------------------------

  onMount(() => {
    const rect = canvasEl.getBoundingClientRect();
    screenBounds = { width: rect.width, height: rect.height };

    applyCamera(camera);

    const ro = new ResizeObserver(() => {
      const r = canvasEl.getBoundingClientRect();
      screenBounds = { width: r.width, height: r.height };
    });
    ro.observe(canvasEl);
    onCleanup(() => ro.disconnect());

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

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [rawDx, rawDy] = normalizeDelta(e);
      if (rawDx === 0 && rawDy === 0) return;

      const rect = canvasEl.getBoundingClientRect();

      if ((e.ctrlKey || e.altKey) && e.buttons === 0) {
        applyCamera(zoomCamera(camera, e.clientX - rect.left, e.clientY - rect.top, rawDy));
      } else {
        const dx = e.shiftKey ? rawDy : rawDx;
        const dy = e.shiftKey ? 0 : rawDy;
        applyCamera({ ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom });
      }
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

    onCleanup(() => {
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
    });
  });

  return (
    <div class="sc-canvas" ref={canvasEl} data-tool={activeTool()}>
      <div class="sc-layer" ref={layerEl}>
        <For each={layerPlugins}>
          {(desc) => (
            <patchwork-view
              style="position:absolute;inset:0;pointer-events:none;"
              doc-url={props.handle.url}
              tool-id={desc.id}
            />
          )}
        </For>
        <div style="position:absolute;inset:0;pointer-events:none;">
          <ShapeRenderLayer
            handle={props.handle}
            repo={(props.canvas as any).repo}
            ref={(api) => {
              shapeLayer = api;
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cameraToTransform(c: Camera): string {
  return `scale(${c.zoom}) translateX(${c.x}px) translateY(${c.y}px)`;
}

function normalizeDelta(e: WheelEvent): [number, number] {
  const factor = e.deltaMode === 1 ? 17 : e.deltaMode === 2 ? 400 : 1;
  return [e.deltaX * factor, e.deltaY * factor];
}

function isTextUnderPointer(x: number, y: number, target: Element | null): boolean {
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
}

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = canvasCss;
  document.head.appendChild(style);
}
