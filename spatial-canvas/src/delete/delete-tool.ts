import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { SpatialCanvasElement, SpatialCanvasHost } from "../canvas/spatial-canvas-element.js";
import { deleteShapes } from "../canvas/commands.js";
import { createElement, Eraser } from 'lucide';

// ============================================================================
// SVG stroke trail
// ============================================================================

const STROKE_COLOR = "rgba(80,80,80,0.55)";
const STROKE_WIDTH = 12;

class EraserTrail {
  private svg: SVGSVGElement;
  private path: SVGPathElement;
  private points: { x: number; y: number }[] = [];
  private layer: HTMLElement;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(layer: HTMLElement) {
    this.layer = layer;

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:visible;";

    this.path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    this.path.setAttribute("fill", "none");
    this.path.setAttribute("stroke", STROKE_COLOR);
    this.path.setAttribute("stroke-width", String(STROKE_WIDTH));
    this.path.setAttribute("stroke-linecap", "round");
    this.path.setAttribute("stroke-linejoin", "round");
    this.svg.appendChild(this.path);
    layer.appendChild(this.svg);
  }

  addPoint(x: number, y: number) {
    if (this.fadeTimer) { clearTimeout(this.fadeTimer); this.fadeTimer = null; }
    this.svg.style.opacity = "1";
    this.svg.style.transition = "";
    this.points.push({ x, y });
    this.path.setAttribute("d", this.buildPath());
  }

  private buildPath(): string {
    const pts = this.points;
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  finish() {
    this.fadeTimer = setTimeout(() => {
      this.svg.style.transition = "opacity 0.4s ease-out";
      this.svg.style.opacity = "0";
      setTimeout(() => this.svg.remove(), 420);
    }, 80);
  }

  dispose() {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.svg.remove();
  }
}

// ============================================================================
// Button indicator — Lucide Eraser icon (inline SVG)
// ============================================================================

const mountEraserButton = (btn: HTMLElement): () => void => {
  const icon = createElement(Eraser, { width: 22, height: 22, style: 'pointer-events:none' });
  btn.appendChild(icon);
  return () => { icon.remove(); };
};

// ============================================================================
// Tool
// ============================================================================

type Vec2 = { x: number; y: number };

const DeleteTool = (handle: DocHandle<CanvasDoc>, buttonEl: PatchworkViewElement): Disposer => {
  const removeIndicator = mountEraserButton(buttonEl);

  let prevScreen: Vec2 | null = null;
  let prevCanvas: Vec2 | null = null;
  let trail: EraserTrail | null = null;

  const getLayer = (): HTMLElement | null =>
    buttonEl.closest(".sc-container")?.querySelector<HTMLElement>(".sc-layer") ?? null;

  const tryDelete = (canvas: SpatialCanvasElement, clientX: number, clientY: number) => {
    const id = canvas.shapesAtPoint(clientX, clientY)[0]?.id ?? null;
    if (id) deleteShapes(handle, [id]);
  };

  const sweep = (canvas: SpatialCanvasElement, fromScreen: Vec2, toScreen: Vec2, fromCanvas: Vec2, toCanvas: Vec2) => {
    const dx = toScreen.x - fromScreen.x;
    const dy = toScreen.y - fromScreen.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = fromScreen.x + dx * t;
      const sy = fromScreen.y + dy * t;
      tryDelete(canvas, sx, sy);
    }
  };

  const onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    const canvas = (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')?.spatialCanvas ?? null;
    const cur: Vec2 = { x: pe.clientX, y: pe.clientY };
    const curC = canvas?.screenToPage(pe.clientX, pe.clientY) ?? cur;

    const layer = getLayer();
    if (layer) {
      trail?.dispose();
      trail = new EraserTrail(layer);
      trail.addPoint(curC.x, curC.y);
    }

    prevScreen = cur;
    prevCanvas = curC;
    if (canvas) sweep(canvas, cur, cur, curC, curC);
  };

  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    const canvas = (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')?.spatialCanvas ?? null;
    const cur: Vec2 = { x: pe.clientX, y: pe.clientY };
    const curC = canvas?.screenToPage(pe.clientX, pe.clientY) ?? cur;
    const from = prevScreen ?? cur;
    const fromC = prevCanvas ?? curC;

    trail?.addPoint(curC.x, curC.y);
    if (canvas) sweep(canvas, from, cur, fromC, curC);

    prevScreen = cur;
    prevCanvas = curC;
  };

  const reset = () => {
    trail?.finish();
    trail = null;
    prevScreen = null;
    prevCanvas = null;
  };

  buttonEl.addEventListener("pointerdown", onPointerDown);
  buttonEl.addEventListener("pointermove", onPointerMove);
  buttonEl.addEventListener("pointerup", reset);
  buttonEl.addEventListener("pointercancel", reset);

  return () => {
    buttonEl.removeEventListener("pointerdown", onPointerDown);
    buttonEl.removeEventListener("pointermove", onPointerMove);
    buttonEl.removeEventListener("pointerup", reset);
    buttonEl.removeEventListener("pointercancel", reset);
    removeIndicator();
    trail?.dispose();
    trail = null;
    prevScreen = null;
    prevCanvas = null;
  };
};

export default DeleteTool;
