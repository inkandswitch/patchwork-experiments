export type Position = { x: number; y: number };

export type LoopBadge = { id: string; label: string; name: string; story: string };

type MarkerStyle = { clockwise: boolean; showName: boolean; arrowId: string };

/** A circular arrow with the loop's badge, drawn in the middle of the loop it names. */
export function drawLoopMarker(loop: LoopBadge, center: Position, { clockwise, showName, arrowId }: MarkerStyle, onHover: (on: boolean) => void): SVGGElement {
  const radius = 19;
  const startAngle = -110;
  const endAngle = startAngle + (clockwise ? 290 : -290);
  const at = (degrees: number) => offset(center, { x: Math.cos(rad(degrees)), y: Math.sin(rad(degrees)) }, radius);
  const [from, to] = [at(startAngle), at(endAngle)];

  const group = svgEl("g", { class: "cld-loop", "data-loop": loop.id });
  const title = svgEl("title", {});
  title.textContent = `${loop.label} ${loop.name}: ${loop.story}`;
  group.append(
    title,
    svgEl("circle", { class: "hit", cx: center.x, cy: center.y, r: radius + 6 }),
    svgEl("path", {
      class: "loop-arrow",
      d: `M${from.x},${from.y} A${radius},${radius} 0 1 ${clockwise ? 1 : 0} ${to.x},${to.y}`,
      "marker-end": `url(#${arrowId})`,
    }),
    svgText(loop.label, center.x, center.y, "loop-label"),
  );
  if (showName) group.append(svgText(loop.name, center.x, center.y + radius + 16, "loop-name"));
  group.addEventListener("mouseenter", () => onHover(true));
  group.addEventListener("mouseleave", () => onHover(false));
  return group;
}

/** The ‖ mark across a link whose effect arrives with a delay. */
export function delayBars(center: Position, direction: Position): SVGGElement {
  const angle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
  const bars = svgEl("g", { class: "delay", transform: `translate(${center.x} ${center.y}) rotate(${angle})` });
  for (const x of [-3, 3]) bars.append(svgEl("line", { x1: x, y1: -8, x2: x, y2: 8 }));
  return bars;
}

export function arrowMarker(id: string): SVGDefsElement {
  const defs = svgEl("defs", {});
  const marker = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
  marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: "arrowhead" }));
  defs.append(marker);
  return defs;
}

/** Positive when the path runs clockwise on screen, where y points down. */
export function signedArea(path: Position[]): number {
  return path.reduce((sum, point, i) => {
    const next = path[(i + 1) % path.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
}

/** Bend is how far the curve bows out, in pixels, to the right of its direction of travel. */
export function controlPoint(from: Position, to: Position, bend: number): Position {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return offset(middle, normal({ x: to.x - from.x, y: to.y - from.y }), bend);
}

export function quadratic(start: Position, control: Position, end: Position, t: number): Position {
  const a = (1 - t) ** 2;
  const b = 2 * (1 - t) * t;
  const c = t ** 2;
  return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y };
}

export function tangent(start: Position, control: Position, end: Position, t: number): Position {
  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y),
  };
}

/** Unit vector pointing to the right of the direction of travel. */
export function normal(direction: Position): Position {
  const length = Math.hypot(direction.x, direction.y) || 1;
  return { x: -direction.y / length, y: direction.x / length };
}

export function offset(point: Position, direction: Position, distance: number): Position {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

/** Where the line from a box's centre towards a point leaves the box. */
export function boxEdge(center: Position, halfWidth: number, halfHeight: number, toward: Position): Position {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const scale = Math.min(halfWidth / Math.abs(dx || 1e-9), halfHeight / Math.abs(dy || 1e-9));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function svgText(content: string, x: number, y: number, className: string): SVGTextElement {
  const text = svgEl("text", { x, y, class: className });
  text.textContent = content;
  return text;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

let ids = 0;

/** Marker ids are document-wide, and a page can show several diagrams. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${++ids}`;
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
