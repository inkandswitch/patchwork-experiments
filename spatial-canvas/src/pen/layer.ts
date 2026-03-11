import { getStroke } from "perfect-freehand";
import type { CanvasDoc, DocHandle } from "../core/types.js";
import type { PenShape } from "./pen-tool.js";

/**
 * PenLayer — renders all shapes with type === 'pen' as SVG paths inside a
 * single <svg> element.
 *
 * The SVG sits at top:0; left:0 with overflow:visible inside the camera-
 * transformed .sc-layer, so all stroke coordinates are already in canvas space.
 * The container has no z-index and does not form a stacking context, allowing
 * pen strokes to interleave freely with shapes from other layers via zIndex.
 */
export default function PenLayer(handle: DocHandle<CanvasDoc>, element: HTMLElement): () => void {
  element.style.cssText = "position:absolute;inset:0;pointer-events:none;";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;top:0;left:0;overflow:visible;pointer-events:none;";
  element.appendChild(svg);

  const mounted = new Map<string, SVGPathElement>();

  function toSvgPath(pts: number[][]): string {
    if (pts.length < 2) return "";
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${pts[i][0]},${pts[i][1]} ${mx},${my}`;
    }
    d += ` Z`;
    return d;
  }

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>();
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === "pen") currentIds.add(shape.id);
    }

    for (const [id, path] of mounted) {
      if (!currentIds.has(id)) {
        path.remove();
        mounted.delete(id);
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== "pen") continue;
      const pen = shape as PenShape;

      let path = mounted.get(pen.id);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.appendChild(path);
        mounted.set(pen.id, path);
      }

      const outline = getStroke(pen.points, { size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
      path.setAttribute("d", toSvgPath(outline));
      path.setAttribute("fill", pen.color);
      path.style.zIndex = String(pen.zIndex);
    }
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    svg.remove();
    mounted.clear();
  };
}
