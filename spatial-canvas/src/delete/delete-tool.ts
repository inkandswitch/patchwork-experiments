import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { SpatialCanvasElement, SpatialCanvasHost } from "../canvas/spatial-canvas-element.js";
import { deleteShapes } from "../canvas/commands.js";
import { createElement, Eraser } from "lucide";

const STROKE_COLOR = "rgba(80,80,80,0.55)";
const STROKE_WIDTH = 12;

type Vec2 = { x: number; y: number };

// ---------------------------------------------------------------------------
// Eraser trail (freehand SVG path that fades out on release)
// ---------------------------------------------------------------------------

const makeEraserTrail = (layer: HTMLElement) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:visible;";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", STROKE_COLOR);
  path.setAttribute("stroke-width", String(STROKE_WIDTH));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  layer.appendChild(svg);

  let points: Vec2[] = [];
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  const buildPath = (): string => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
    }
    d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return d;
  };

  return {
    addPoint(p: Vec2) {
      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }
      svg.style.opacity = "1";
      svg.style.transition = "";
      points.push(p);
      path.setAttribute("d", buildPath());
    },
    finish() {
      fadeTimer = setTimeout(() => {
        svg.style.transition = "opacity 0.4s ease-out";
        svg.style.opacity = "0";
        setTimeout(() => svg.remove(), 420);
      }, 80);
    },
    dispose() {
      if (fadeTimer) clearTimeout(fadeTimer);
      svg.remove();
    },
  };
};

type EraserTrail = ReturnType<typeof makeEraserTrail>;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const DeleteTool = (handle: DocHandle<CanvasDoc>, buttonEl: PatchworkViewElement): Disposer => {
  const icon = createElement(Eraser, { width: 22, height: 22, style: "pointer-events:none" });
  buttonEl.appendChild(icon);

  let prevScreen: Vec2 | null = null;
  let prevCanvas: Vec2 | null = null;
  let trail: EraserTrail | null = null;

  const getLayer = (): HTMLElement | null =>
    buttonEl.closest(".sc-container")?.querySelector<HTMLElement>(".sc-layer") ?? null;

  const getCanvas = (e: Event): SpatialCanvasElement | null =>
    (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')
      ?.spatialCanvas ?? null;

  const tryDelete = (canvas: SpatialCanvasElement, sx: number, sy: number) => {
    const id = canvas.shapesAtPoint(sx, sy)[0]?.id ?? null;
    if (id) deleteShapes(handle, [id]);
  };

  const sweep = (
    canvas: SpatialCanvasElement,
    fromScreen: Vec2,
    toScreen: Vec2,
    fromCanvas: Vec2,
    toCanvas: Vec2,
  ) => {
    const dx = toScreen.x - fromScreen.x;
    const dy = toScreen.y - fromScreen.y;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      tryDelete(canvas, fromScreen.x + dx * t, fromScreen.y + dy * t);
      trail?.addPoint({
        x: fromCanvas.x + (toCanvas.x - fromCanvas.x) * t,
        y: fromCanvas.y + (toCanvas.y - fromCanvas.y) * t,
      });
    }
  };

  const onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    const canvas = getCanvas(e);
    const cur: Vec2 = { x: pe.clientX, y: pe.clientY };
    const curC = canvas?.screenToPage(pe.clientX, pe.clientY) ?? cur;

    const layer = getLayer();
    if (layer) {
      trail?.dispose();
      trail = makeEraserTrail(layer);
      trail.addPoint(curC);
    }

    prevScreen = cur;
    prevCanvas = curC;
    if (canvas) sweep(canvas, cur, cur, curC, curC);
  };

  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    const canvas = getCanvas(e);
    const cur: Vec2 = { x: pe.clientX, y: pe.clientY };
    const curC = canvas?.screenToPage(pe.clientX, pe.clientY) ?? cur;
    if (canvas) sweep(canvas, prevScreen ?? cur, cur, prevCanvas ?? curC, curC);
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
    icon.remove();
    trail?.dispose();
    trail = null;
  };
};

export default DeleteTool;
