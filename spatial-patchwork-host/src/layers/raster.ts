/**
 * Shared rasterization helpers for the claim mask. Recognizers use fillPolygon
 * to stamp their claimed regions (frame-pixel polygons) into the shared
 * Frame.mask so later layers in the pipeline ignore those pixels.
 */

import type { FramePoint } from "./types.js";

/**
 * Scanline-fill a polygon into a w*h mask buffer (sets covered pixels to 1).
 * Polygon points are in frame-pixel coordinates.
 */
export function fillPolygon(
  mask: Uint8Array,
  w: number,
  h: number,
  poly: FramePoint[],
): void {
  if (poly.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      // Edge crosses the scanline?
      if (a.y <= yc ? b.y > yc : b.y <= yc) {
        const t = (yc - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * w + x] = 1;
    }
  }
}
