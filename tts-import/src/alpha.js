// What shape an image's opaque pixels make: a token's outline. Pure.
//
// TTS cuts a Custom_Token out of its image's transparency. We don't trace the
// outline; we tell the three common cases apart and draw each as well as we
// can: "opaque" (a rectangle), "circle" (an ellipse filling the image's box —
// most round chits) and "cutout" (anything else: drawn as alpha-masked top
// and bottom faces with no sides).

/**
 * @param {Uint8Array} rgba  w*h*4 pixels (a small thumbnail is plenty)
 * @returns {"opaque" | "circle" | "cutout"}
 */
export function alphaShape(rgba, w, h) {
  let opaque = 0, inside = 0, insideOpaque = 0, outside = 0, outsideClear = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3];
      if (a >= 128) opaque++;
      const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
      const r = Math.hypot(dx * 2, dy * 2);
      if (r < 0.9) {
        inside++;
        if (a >= 128) insideOpaque++;
      } else if (r > 1.1) {
        outside++;
        if (a < 128) outsideClear++;
      }
    }
  if (opaque >= 0.98 * w * h) return "opaque";
  if (inside && outside && insideOpaque >= 0.95 * inside && outsideClear >= 0.85 * outside) return "circle";
  return "cutout";
}

/** Does any pixel have alpha below 250? */
export function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true;
  return false;
}

/** The pixel rectangle of a fractional rect on a w × h image (at least 1 × 1). */
export function pixelRect(rect, w, h) {
  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.max(0, Math.min(w - 1, Math.round(r.x * w)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(r.y * h)));
  const sw = Math.max(1, Math.min(w - sx, Math.round(r.w * w)));
  const sh = Math.max(1, Math.min(h - sy, Math.round(r.h * h)));
  return { sx, sy, sw, sh };
}

/** The size a crop is drawn at: no bigger than it is, its longer side at most maxSize. */
export function fitSize(sw, sh, maxSize) {
  const k = Math.min(1, maxSize / Math.max(sw, sh));
  return { dw: Math.max(1, Math.round(sw * k)), dh: Math.max(1, Math.round(sh * k)) };
}
