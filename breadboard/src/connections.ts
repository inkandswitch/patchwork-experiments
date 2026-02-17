import type { PlacedCard } from "./types.js";

export function createSvgOverlay(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;";
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  return svg;
}

export function drawConnections(svg: SVGSVGElement, cards: PlacedCard[]): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  for (const c of cards) {
    const cr = c.card.getBoundingClientRect();
    const er = c.view.element.getBoundingClientRect();
    if (cr.width === 0 || er.width === 0) continue;

    const from = edgePoint(cr, er.left + er.width / 2, er.top + er.height / 2);
    const to = edgePoint(er, cr.left + cr.width / 2, cr.top + cr.height / 2);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", "rgba(120, 140, 255, 0.4)");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  }
}

function edgePoint(rect: DOMRect, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return { x: cx, y: rect.top };

  const hw = rect.width / 2;
  const hh = rect.height / 2;

  if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
    const s = dx > 0 ? 1 : -1;
    return { x: cx + s * hw, y: cy + (dy * hw) / Math.abs(dx) };
  } else {
    const s = dy > 0 ? 1 : -1;
    return { x: cx + (dx * hh) / Math.abs(dy), y: cy + s * hh };
  }
}
