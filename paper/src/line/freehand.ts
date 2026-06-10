import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Point } from "../surface/types";

// Pen feel for the freehand tool. `size` is the base diameter; it is overridden
// per-shape so each stroke can carry its own width.
export const FREEHAND_OPTIONS: StrokeOptions = {
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
};

// Turn a run of input points into SVG path data for a pressure-sensitive
// stroke. perfect-freehand expands the centerline into a filled outline
// polygon, which we render as a single filled <path>. Returns "" when there
// are too few points to form an outline.
export function freehandPath(points: Point[], size?: number): string {
  if (points.length === 0) return "";
  const options =
    size === undefined ? FREEHAND_OPTIONS : { ...FREEHAND_OPTIONS, size };
  const outline = getStroke(
    points.map((p) => [p.x, p.y]),
    options,
  );
  return svgPathFromStroke(outline);
}

// Standard quadratic-smoothed path builder from the perfect-freehand docs.
function svgPathFromStroke(stroke: number[][], closed = true): string {
  const len = stroke.length;
  if (len < 4) return "";

  let a = stroke[0];
  let b = stroke[1];
  const c = stroke[2];
  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(
    2,
  )} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = stroke[i];
    b = stroke[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  if (closed) result += "Z";
  return result;
}

function average(a: number, b: number): number {
  return (a + b) / 2;
}
