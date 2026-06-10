import { Outline, Point, Shape } from "../surface/types";

// Slack (px) around a stroke's centerline for hit detection. Roughly half a
// freehand stroke's width plus a little extra so thin/thick strokes alike are
// easy to click.
const LINE_HIT_PADDING = 8;

// Decide whether `point` (in canvas coordinates) lands on `shape`. Works off
// the shape's resolved outline, so it is agnostic to which tool drew it.
export function hitTestShape(x: number, y: number, shape: Shape): boolean {
  const outline = resolveOutline(shape);
  if (!outline) return false;
  const localX = x - shape.x;
  const localY = y - shape.y;
  switch (outline.type) {
    case "rectangle":
      return (
        localX >= 0 &&
        localY >= 0 &&
        localX <= outline.width &&
        localY <= outline.height
      );
    case "polygon":
      return pointInPolygon(localX, localY, outline.points);
    case "line":
      return (
        distanceToPolyline(localX, localY, outline.points) <= LINE_HIT_PADDING
      );
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

// Standard even-odd ray cast: is the point (x, y) inside the polygon `points`?
function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const intersects =
      a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Shortest distance from point (x, y) to a connected run of segments.
function distanceToPolyline(x: number, y: number, points: Point[]): number {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distanceToSegment(x, y, points[i - 1], points[i]));
  }
  return min;
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
