import type { CanvasDoc, DocHandle, Disposer } from "../core/types.js";
import { deleteShapes } from "../core/commands.js";
import { createElement, Eraser } from 'lucide';

/** Maximum screen-space distance (px) between hit-test samples during a sweep. */
const MAX_HIT_GAP = 4;

// ============================================================================
// Hit detection
// ============================================================================

function shapeIdAt(screenX: number, screenY: number): string | null {
  for (const el of document.elementsFromPoint(screenX, screenY)) {
    let node: Element | null = el;
    while (node) {
      const id = (node as HTMLElement).dataset?.shapeId;
      if (id) return id;
      node = node.parentElement;
    }
  }
  return null;
}

// ============================================================================
// Fading trail
// ============================================================================

function spawnTrail(canvasX: number, canvasY: number, layer: HTMLElement) {
  const dot = document.createElement("div");
  dot.style.cssText = ["position:absolute", "top:0", "left:0", "width:14px", "height:14px", "border-radius:50%", "background:rgba(120,120,120,0.5)", "pointer-events:none", `transform:translate(${canvasX - 7}px,${canvasY - 7}px) scale(1)`, "transition:opacity 0.3s ease-out, transform 0.3s ease-out", "transform-origin:center center"].join(";");
  layer.appendChild(dot);
  requestAnimationFrame(() => {
    dot.style.opacity = "0";
    dot.style.transform = `translate(${canvasX - 7}px,${canvasY - 7}px) scale(0.1)`;
  });
  setTimeout(() => dot.remove(), 350);
}

// ============================================================================
// Button indicator — Lucide Eraser icon (inline SVG)
// ============================================================================

function mountEraserButton(btn: HTMLElement): () => void {
  const icon = createElement(Eraser, { width: 22, height: 22, style: 'pointer-events:none' });
  btn.appendChild(icon);
  return () => { icon.remove(); };
}

// ============================================================================
// Tool
// ============================================================================

interface PointerDetail {
  canvasX: number;
  canvasY: number;
  screenX: number;
  screenY: number;
}

type Vec2 = { x: number; y: number };

export default function DeleteTool(handle: DocHandle<CanvasDoc>, buttonEl: HTMLElement): Disposer {
  const removeIndicator = mountEraserButton(buttonEl);

  let prevScreen: Vec2 | null = null;
  let prevCanvas: Vec2 | null = null;

  function getLayer(): HTMLElement | null {
    return buttonEl.closest(".sc-container")?.querySelector<HTMLElement>(".sc-layer") ?? null;
  }

  function tryDelete(screenX: number, screenY: number) {
    const id = shapeIdAt(screenX, screenY);
    if (id) deleteShapes(handle, [id]);
  }

  /**
   * Interpolate hit-test samples along the segment from `fromScreen` to
   * `toScreen`, ensuring no gap is larger than MAX_HIT_GAP pixels.
   */
  function sweep(fromScreen: Vec2, toScreen: Vec2, fromCanvas: Vec2, toCanvas: Vec2, layer: HTMLElement | null) {
    const dx = toScreen.x - fromScreen.x;
    const dy = toScreen.y - fromScreen.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / MAX_HIT_GAP));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = fromScreen.x + dx * t;
      const sy = fromScreen.y + dy * t;
      const cx = fromCanvas.x + (toCanvas.x - fromCanvas.x) * t;
      const cy = fromCanvas.y + (toCanvas.y - fromCanvas.y) * t;
      if (layer) spawnTrail(cx, cy, layer);
      tryDelete(sx, sy);
    }
  }

  function onPointerDown(e: Event) {
    const { screenX, screenY, canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail;
    const cur: Vec2 = { x: screenX, y: screenY };
    const curC: Vec2 = { x: canvasX, y: canvasY };
    // Seed prev and do a single-point sweep
    prevScreen = cur;
    prevCanvas = curC;
    sweep(cur, cur, curC, curC, getLayer());
  }

  function onPointerMove(e: Event) {
    const { screenX, screenY, canvasX, canvasY } = (e as CustomEvent<PointerDetail>).detail;
    const cur: Vec2 = { x: screenX, y: screenY };
    const curC: Vec2 = { x: canvasX, y: canvasY };
    const from = prevScreen ?? cur;
    const fromC = prevCanvas ?? curC;
    sweep(from, cur, fromC, curC, getLayer());
    prevScreen = cur;
    prevCanvas = curC;
  }

  function reset() {
    prevScreen = null;
    prevCanvas = null;
  }

  buttonEl.addEventListener("spatial-canvas:pointerdown", onPointerDown);
  buttonEl.addEventListener("spatial-canvas:pointermove", onPointerMove);
  buttonEl.addEventListener("spatial-canvas:pointerup", reset);
  buttonEl.addEventListener("spatial-canvas:cancel", reset);

  return () => {
    buttonEl.removeEventListener("spatial-canvas:pointerdown", onPointerDown);
    buttonEl.removeEventListener("spatial-canvas:pointermove", onPointerMove);
    buttonEl.removeEventListener("spatial-canvas:pointerup", reset);
    buttonEl.removeEventListener("spatial-canvas:cancel", reset);
    removeIndicator();
    reset();
  };
}
