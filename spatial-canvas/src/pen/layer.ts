import { getStroke } from "perfect-freehand";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc } from "../core/types.js";
import type { PenShape } from "./pen-tool.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

/**
 * PenLayer — renders each 'pen' shape as its own <svg> element so that CSS
 * z-index on the SVG participates in the same stacking context as the
 * rectangle <div> elements from other layers.
 *
 * A single shared <svg> would make all pen paths a single stacking unit,
 * preventing cross-layer z-index interleaving. One SVG per stroke fixes this.
 */
export default function PenLayer(handle: DocHandle<CanvasDoc>, element: PatchworkViewElement): () => void {
  element.style.cssText = "position:absolute;inset:0;";

  /** shapeId → the <svg> wrapper element for that stroke */
  const mounted = new Map<string, { svg: SVGSVGElement; path: SVGPathElement }>();

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

    for (const [id, { svg }] of mounted) {
      if (!currentIds.has(id)) {
        svg.remove();
        mounted.delete(id);
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== "pen") continue;
      const pen = shape as PenShape;

      let entry = mounted.get(pen.id);
      if (!entry) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position:absolute;top:0;left:0;overflow:visible;";

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.dataset.shapeId = pen.id;
        path.style.pointerEvents = "fill";
        svg.appendChild(path);
        element.appendChild(svg);

        entry = { svg, path };
        mounted.set(pen.id, entry);
      }

      const { svg, path } = entry;
      const outline = getStroke(pen.points, { size: 6, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
      path.setAttribute("d", toSvgPath(outline));
      path.setAttribute("fill", pen.color);
      path.setAttribute("transform", `translate(${pen.x},${pen.y})`);
      svg.style.zIndex = String(pen.zIndex);
    }
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    for (const { svg } of mounted.values()) svg.remove();
    mounted.clear();
  };
}
