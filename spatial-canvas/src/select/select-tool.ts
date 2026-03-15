import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { SpatialCanvasElement, SpatialCanvasHost } from "../canvas/spatial-canvas-element.js";
import { translateShapes, nextZIndex } from "../canvas/commands.js";
import { createElement, MousePointer2 } from "lucide";

/** Maximum screen-space gap (px) between hit-test samples during line-draw sweep. */
const MAX_HIT_GAP = 4;

type Vec2 = { x: number; y: number };

// ============================================================================
// Button indicator — dashed selection rectangle
// ============================================================================

function mountSelectButton(btn: HTMLElement): () => void {
  const icon = createElement(MousePointer2, {
    width: 22,
    height: 22,
    style: "pointer-events:none",
  });
  btn.appendChild(icon);
  return () => {
    icon.remove();
  };
}

// ============================================================================
// Helpers
// ============================================================================

function ensureUserState(d: CanvasDoc, contactUrl: string) {
  if (!d.stateByUser) d.stateByUser = {};
  if (!d.stateByUser[contactUrl]) {
    d.stateByUser[contactUrl] = { selection: {}, color: "#1a1a1a" };
  }
  if (!d.stateByUser[contactUrl].selection) {
    d.stateByUser[contactUrl].selection = {};
  }
}

// ============================================================================
// Tool
// ============================================================================

export default function SelectTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: PatchworkViewElement,
): Disposer {
  const removeIndicator = mountSelectButton(buttonEl);

  const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? "local";

  // --- Mode ---
  type Mode = "idle" | "line" | "drag";
  let mode: Mode = "idle";

  // --- Line-draw state ---
  let lineSvg: SVGSVGElement | null = null;
  let linePolyline: SVGPolylineElement | null = null;
  let linePoints: [number, number][] = [];
  let prevScreen: Vec2 | null = null;
  let prevCanvas: Vec2 | null = null;

  // --- Drag state ---
  let dragStartCanvas: Vec2 | null = null;
  let dragOrigins: Map<string, Vec2> = new Map();

  // ---- selection helpers ----

  function getMyIds(): string[] {
    return Object.keys(handle.doc()?.stateByUser?.[contactUrl]?.selection ?? {});
  }

  function isSelected(id: string): boolean {
    return handle.doc()?.stateByUser?.[contactUrl]?.selection?.[id] === true;
  }

  function clearSelection() {
    handle.change((d) => {
      ensureUserState(d, contactUrl);
      d.stateByUser[contactUrl].selection = {};
    });
  }

  function addToSelectionBatch(ids: string[]) {
    if (ids.length === 0) return;
    handle.change((d) => {
      ensureUserState(d, contactUrl);
      for (const id of ids) {
        d.stateByUser[contactUrl].selection[id] = true;
      }
    });
  }

  // ---- layer helper ----

  function getLayer(): HTMLElement | null {
    return buttonEl.closest(".sc-container")?.querySelector<HTMLElement>(".sc-layer") ?? null;
  }

  // ---- line drawing ----

  function startLine(canvasX: number, canvasY: number, layer: HTMLElement) {
    lineSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lineSvg.style.cssText = "position:absolute;top:0;left:0;overflow:visible;pointer-events:none;";

    linePolyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    linePolyline.setAttribute("stroke", "#1a73e8");
    linePolyline.setAttribute("stroke-width", "3");
    linePolyline.setAttribute("stroke-linecap", "round");
    linePolyline.setAttribute("stroke-linejoin", "round");
    linePolyline.setAttribute("fill", "none");
    linePolyline.setAttribute("opacity", "0.45");
    lineSvg.appendChild(linePolyline);

    // Insert as first child so it renders below all shapes
    layer.insertBefore(lineSvg, layer.firstChild);

    linePoints = [[canvasX, canvasY]];
    linePolyline.setAttribute("points", `${canvasX},${canvasY}`);
  }

  function extendLine(canvasX: number, canvasY: number) {
    if (!linePolyline) return;
    linePoints.push([canvasX, canvasY]);
    linePolyline.setAttribute("points", linePoints.map((p) => p.join(",")).join(" "));
  }

  function removeLine() {
    lineSvg?.remove();
    lineSvg = null;
    linePolyline = null;
    linePoints = [];
  }

  // ---- sweep interpolation ----

  function sweep(
    canvas: SpatialCanvasElement,
    fromScreen: Vec2,
    toScreen: Vec2,
    fromCanvas: Vec2,
    toCanvas: Vec2,
  ) {
    const dx = toScreen.x - fromScreen.x;
    const dy = toScreen.y - fromScreen.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / MAX_HIT_GAP));

    const newIds: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = fromScreen.x + dx * t;
      const sy = fromScreen.y + dy * t;
      const cx = fromCanvas.x + (toCanvas.x - fromCanvas.x) * t;
      const cy = fromCanvas.y + (toCanvas.y - fromCanvas.y) * t;
      extendLine(cx, cy);
      const id = canvas.shapesAtPoint(sx, sy)[0]?.id ?? null;
      if (id && !isSelected(id) && !newIds.includes(id)) newIds.push(id);
    }
    addToSelectionBatch(newIds);
  }

  // ---- event handlers ----

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    const canvas =
      (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')
        ?.spatialCanvas ?? null;
    const hitId = canvas?.shapesAtPoint(pe.clientX, pe.clientY)[0]?.id ?? null;
    const pos = canvas?.screenToPage(pe.clientX, pe.clientY);

    if (hitId) {
      if (!isSelected(hitId)) {
        clearSelection();
        addToSelectionBatch([hitId]);
      }
      mode = "drag";
      dragStartCanvas = pos ?? null;
      const doc = handle.doc();
      const ids = getMyIds().filter((id) => doc?.shapes[id]);
      dragOrigins = new Map(ids.map((id) => [id, { x: doc!.shapes[id].x, y: doc!.shapes[id].y }]));
      handle.change((d) => {
        const base = nextZIndex(d);
        const sorted = [...ids].sort((a, b) => d.shapes[a].zIndex - d.shapes[b].zIndex);
        sorted.forEach((id, i) => {
          d.shapes[id].zIndex = base + i;
        });
      });
    } else {
      clearSelection();
      mode = "line";
      const layer = getLayer();
      if (layer && pos) startLine(pos.x, pos.y, layer);
      prevScreen = { x: pe.clientX, y: pe.clientY };
      prevCanvas = pos ?? null;
    }
  }

  function onPointerMove(e: Event) {
    const pe = e as PointerEvent;
    const canvas =
      (e.target as Element).closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]')
        ?.spatialCanvas ?? null;
    const pos = canvas?.screenToPage(pe.clientX, pe.clientY);

    if (mode === "drag" && dragStartCanvas && pos) {
      const delta = { x: pos.x - dragStartCanvas.x, y: pos.y - dragStartCanvas.y };
      const moves = new Map(
        [...dragOrigins].map(([id, o]) => [id, { x: o.x + delta.x, y: o.y + delta.y }]),
      );
      translateShapes(handle, moves);
    } else if (mode === "line" && canvas && pos) {
      const fromScreen = prevScreen ?? { x: pe.clientX, y: pe.clientY };
      const fromCanvas = prevCanvas ?? pos;
      sweep(canvas, fromScreen, { x: pe.clientX, y: pe.clientY }, fromCanvas, pos);
      prevScreen = { x: pe.clientX, y: pe.clientY };
      prevCanvas = pos;
    }
  }

  function onPointerUp() {
    if (mode === "line") removeLine();
    mode = "idle";
    dragStartCanvas = null;
    dragOrigins.clear();
    prevScreen = null;
    prevCanvas = null;
  }

  function onCancel() {
    if (mode === "line") removeLine();
    mode = "idle";
    dragStartCanvas = null;
    dragOrigins.clear();
    prevScreen = null;
    prevCanvas = null;
  }

  buttonEl.addEventListener("pointerdown", onPointerDown);
  buttonEl.addEventListener("pointermove", onPointerMove);
  buttonEl.addEventListener("pointerup", onPointerUp);
  buttonEl.addEventListener("pointercancel", onCancel);

  return () => {
    buttonEl.removeEventListener("pointerdown", onPointerDown);
    buttonEl.removeEventListener("pointermove", onPointerMove);
    buttonEl.removeEventListener("pointerup", onPointerUp);
    buttonEl.removeEventListener("pointercancel", onCancel);
    handle.change((d) => {
      if (d.stateByUser?.[contactUrl]) {
        d.stateByUser[contactUrl].selection = {};
      }
    });
    removeLine();
    removeIndicator();
  };
}
