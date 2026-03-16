import { getStroke } from "perfect-freehand";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { PenShape } from "./pen-tool.js";

const PEN_SIZE = 6;

/**
 * canvas-pen — renders the visual content of a pen stroke shape.
 *
 * Layout (position, zIndex) is applied by <patchwork-ref-view>. This tool
 * renders an SVG stroke into the element.
 *
 * Note: pen shapes have no fixed width/height — the stroke overflows the
 * zero-size element via overflow:visible on the SVG.
 */
export default function CanvasPenTool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
  refUrl: string,
): Disposer {
  const shapeId = decodeURIComponent(refUrl.split("/").pop() ?? "");
  console.log("[canvas-pen] mounted for shapeId:", shapeId);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;top:0;left:0;overflow:visible;pointer-events:none;";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.style.pointerEvents = "fill";
  svg.appendChild(path);
  element.appendChild(svg);

  function render({ doc }: { doc: CanvasDoc }) {
    const shape = doc.shapes[shapeId] as PenShape | undefined;
    if (!shape?.points?.length) {
      console.log("[canvas-pen] render: shape missing or no points", { shapeId, shape });
      return;
    }

    // Guard against any NaN/undefined values that could produce invalid SVG
    const cleanPoints = shape.points.filter(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        p[0] != null &&
        p[1] != null &&
        isFinite(p[0]) &&
        isFinite(p[1]),
    ) as [number, number, number][];
    console.log(
      "[canvas-pen] render: points total",
      shape.points.length,
      "clean",
      cleanPoints.length,
      "first:",
      cleanPoints[0],
    );
    if (cleanPoints.length < 2) return;

    const outline = getStroke(cleanPoints, {
      size: PEN_SIZE,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
    });

    const cleanOutline = outline.filter((p) => isFinite(p[0]) && isFinite(p[1]));
    console.log(
      "[canvas-pen] render: outline points total",
      outline.length,
      "clean",
      cleanOutline.length,
      "first:",
      cleanOutline[0],
    );
    if (cleanOutline.length < 2) return;
    const d = toSvgPath(cleanOutline);
    console.log("[canvas-pen] render: path d (first 80 chars):", d.slice(0, 80));
    path.setAttribute("d", d);
    path.setAttribute("fill", shape.color);
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    svg.remove();
  };
}

function toSvgPath(pts: number[][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    if (!isFinite(mx) || !isFinite(my)) continue;
    d += ` Q ${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  d += ` Z`;
  return d;
}
