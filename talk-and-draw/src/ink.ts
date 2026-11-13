/**
 * Ink geometry and drawing shared by the on-screen overlay and the model-facing
 * snapshots. Pure canvas-2d; no DOM, no LM runtime.
 *
 * Coordinates are LM canvas pixels (the LM canvas is 1x, so these equal CSS pixels
 * and pointer-event coordinates). Times are ms since the session's t0.
 */

export interface InkPoint {
  x: number;
  y: number;
  t: number;
}

export interface Stroke {
  id: number;
  points: InkPoint[];
  /** ms since session t0 */
  t0: number;
  /** ms since session t0; null while the stroke is still being drawn */
  t1: number | null;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bright purple, the user's disappearing ink. */
export const USER_INK_COLOR = '#b400ff';
/** On-screen stroke width (CSS px). */
export const USER_INK_WIDTH = 3.5;
/** Stroke width in the model's images (canvas px, before scaling), so ink survives downscaling. */
export const SNAPSHOT_INK_WIDTH = 5;
/** A finished stroke stays fully visible this long… */
export const LINGER_MS = 2000;
/** …then dissolves over this long. */
export const FADE_MS = 750;

export function strokeBBox(points: readonly InkPoint[]): BBox {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (points.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

/**
 * Draws a stroke as a smooth path: straight segments between consecutive midpoints
 * would be jagged, so each midpoint-to-midpoint piece is a quadratic curve whose
 * control point is the sample in between. A single sample draws a dot.
 */
export function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  color: string,
  width: number,
  alpha = 1,
): void {
  if (points.length === 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const q = points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** A small numbered badge next to a stroke's first point, for the model's images. */
export function drawStrokeLabel(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string,
): void {
  if (stroke.points.length === 0) return;
  const p = stroke.points[0];
  const r = 9;
  const cx = p.x - r - 4;
  const cy = p.y - r - 4;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(stroke.id), cx, cy + 0.5);
  ctx.restore();
}

/** Alpha of a finished stroke `sinceEndMs` after its end: 1, then a linear dissolve. */
export function dissolveAlpha(sinceEndMs: number, lingerMs = LINGER_MS): number {
  if (sinceEndMs < lingerMs) return 1;
  const f = (sinceEndMs - lingerMs) / FADE_MS;
  return f >= 1 ? 0 : 1 - f;
}
