// `patchwork:ref-view`: names and draws what a comment thread's refs point at
// in a graph, for the comments sidebar, even when the graph isn't open. Kept
// light (plain DOM, no framework): it's loaded into the sidebar, not the tool.

import { type Cell, type GraphDoc } from "./model";
import { cellSwatch, describeCells, findCell, parseCellRef } from "./comments";

/** The slice of a DocHandle this reads. */
type RefHandle = { url: string; doc(): unknown };

/** The cells the refs point at that still exist, in ref order. */
export function resolveCells(refs: RefHandle[], doc: RefHandle): Cell[] {
  const graph = doc.doc() as GraphDoc | undefined;
  const cells: Cell[] = [];
  for (const ref of refs) {
    const parsed = parseCellRef(ref.url);
    if (!parsed) continue;
    const cell = findCell(graph, parsed) ?? (ref.doc() as Cell | undefined);
    if (cell && typeof cell === "object" && typeof cell.id === "string") cells.push(cell);
  }
  return cells;
}

const SVG = "http://www.w3.org/2000/svg";
const el = (name: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A tiny picture of the cells: up to three nodes fanned out, or an arrow for an edge. */
export function drawThumbnail(cells: Cell[]): SVGSVGElement {
  const svg = el("svg", { viewBox: "0 0 44 28", width: "100%", height: "100%" }) as SVGSVGElement;
  svg.setAttribute("aria-hidden", "true");
  const nodes = cells.filter((c) => !c.edge).slice(0, 3);
  if (!nodes.length) {
    const stroke = cells[0] ? cellSwatch(cells[0]).stroke : "#333333";
    svg.append(
      el("path", { d: "M6 22 L36 8", stroke, "stroke-width": 1.6, fill: "none" }),
      el("path", { d: "M38 7 L31 7.5 L34 12.5 Z", fill: stroke }),
    );
    return svg;
  }
  const w = 30 - (nodes.length - 1) * 4;
  const h = 16 - (nodes.length - 1) * 2;
  nodes.forEach((cell, i) => {
    const { shape, fill, stroke } = cellSwatch(cell);
    const x = 4 + i * 5;
    const y = 4 + i * 3;
    svg.append(
      shape === "rhombus"
        ? el("path", {
            d: `M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z`,
            fill,
            stroke,
            "stroke-width": 1,
          })
        : el("rect", { x, y, width: w, height: h, rx: 3, fill, stroke, "stroke-width": 1 }),
    );
  });
  return svg;
}

const refView = {
  describe(refs: RefHandle[], doc: RefHandle): string | null {
    return describeCells(resolveCells(refs, doc));
  },
  thumbnail(refs: RefHandle[], doc: RefHandle, element: HTMLElement): () => void {
    const cells = resolveCells(refs, doc);
    if (!cells.length) return () => {};
    const svg = drawThumbnail(cells);
    element.append(svg);
    return () => svg.remove();
  },
};

export default refView;
