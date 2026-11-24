/**
 * Snapshots for the model: the captured screen (see screen.ts) with the session's strokes drawn on
 * top at full opacity — rendered from stroke data, never from the overlay, so the
 * on-screen dissolve can never leak into what the model sees.
 */
import type { Screen } from './screen';
import { SNAPSHOT_INK_WIDTH, USER_INK_COLOR, drawSmoothPath, drawStrokeLabel, type Stroke } from './ink';

/** Claude resizes images whose long edge exceeds this… */
export const MAX_LONG_EDGE = 1568;
/** …or whose area exceeds roughly this many pixels. Stay under both so the model's
 *  image coordinates are exactly the ones we sent. */
export const MAX_PIXELS = 1_150_000;

export interface ImageScale {
  scale: number;
  width: number;
  height: number;
}

/** One scale per session: canvas → image, aspect ratio preserved. */
export function imageScale(canvasWidth: number, canvasHeight: number): ImageScale {
  const w = Math.max(1, canvasWidth);
  const h = Math.max(1, canvasHeight);
  const long = Math.max(w, h);
  const scale = Math.min(1, MAX_LONG_EDGE / long, Math.sqrt(MAX_PIXELS / (w * h)));
  return { scale, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export interface Snapshot {
  label: string;
  /** ms since session t0 */
  t: number;
  width: number;
  height: number;
  dataUrl: string;
}

/** Extra ink drawn as-is (e.g. the AI's live strokes for its screenshot tool). */
export interface ExtraInk {
  points: readonly Stroke['points'][number][];
  color: string;
}

export function compositeSnapshot(
  screen: Screen,
  strokes: readonly Stroke[],
  img: ImageScale,
  label: string,
  t: number,
  extra: readonly ExtraInk[] = [],
): Snapshot {
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.scale(img.scale, img.scale);
  screen.draw(ctx, screen.width, screen.height);
  for (const s of strokes) {
    drawSmoothPath(ctx, s.points, USER_INK_COLOR, SNAPSHOT_INK_WIDTH, 1);
  }
  for (const s of strokes) drawStrokeLabel(ctx, s, USER_INK_COLOR);
  for (const e of extra) drawSmoothPath(ctx, e.points, e.color, SNAPSHOT_INK_WIDTH, 1);
  return { label, t, width: out.width, height: out.height, dataUrl: out.toDataURL('image/jpeg', 0.9) };
}
