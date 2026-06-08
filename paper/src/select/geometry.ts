import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Outline, Point, Shape } from "../surface/types";

// Slack (px) around a stroke's centerline for hit detection. Roughly half a
// freehand stroke's width plus a little extra so thin/thick strokes alike are
// easy to click.
const LINE_HIT_PADDING = 8;

// Decide whether `point` (in canvas coordinates) lands on `shape`. Works off
// the shape's resolved outline, so it is agnostic to which tool drew it.
export function hitTestShape(shape: Shape, point: Point): boolean {
  const outline = resolveOutline(shape);
  if (!outline) return false;
  const local = { x: point.x - shape.x, y: point.y - shape.y };
  switch (outline.type) {
    case "rectangle":
      return (
        local.x >= 0 &&
        local.y >= 0 &&
        local.x <= outline.width &&
        local.y <= outline.height
      );
    case "polygon":
      return pointInPolygon(local, outline.points);
    case "line":
      return distanceToPolyline(local, outline.points) <= LINE_HIT_PADDING;
  }
}

// The geometry every consumer (rendering, hit detection, overlay) reads from.
// New shapes always carry an `outline`; older persisted shapes are mapped from
// their legacy top-level fields so they keep working.
export function resolveOutline(shape: Shape): Outline | undefined {
  if (shape.outline) return shape.outline;
  const legacy = shape as Shape & { x2?: number; y2?: number };
  if (typeof legacy.x2 === "number" && typeof legacy.y2 === "number") {
    return {
      type: "line",
      points: [
        { x: 0, y: 0 },
        { x: legacy.x2 - shape.x, y: legacy.y2 - shape.y },
      ],
    };
  }
  if (typeof shape.width === "number" && typeof shape.height === "number") {
    return { type: "rectangle", width: shape.width, height: shape.height };
  }
  return undefined;
}

// The points an outline draws, in the shape's local space. Lets the overlay
// render a highlight for any outline variant without special-casing callers.
export function outlinePoints(outline: Outline): Point[] {
  switch (outline.type) {
    case "rectangle":
      return [
        { x: 0, y: 0 },
        { x: outline.width, y: 0 },
        { x: outline.width, y: outline.height },
        { x: 0, y: outline.height },
      ];
    case "line":
    case "polygon":
      return outline.points;
  }
}

// A stable-enough key for a shape: the layer it lives in plus its index. We
// have no per-shape id and no sub-document urls, so this composite is what we
// store in the shared focus doc's `selection` map.
export function shapeRef(layerUrl: AutomergeUrl, index: number): string {
  return `${layerUrl}#${index}`;
}

// Standard even-odd ray cast: is `point` inside the polygon `points`?
function pointInPolygon(point: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Shortest distance from `point` to a connected run of segments.
function distanceToPolyline(point: Point, points: Point[]): number {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distanceToSegment(point, points[i - 1], points[i]));
  }
  return min;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
