// Pure camera math (world ↔ screen). `cam` = {x, y, z}; `cssW`/`cssH` are the
// viewport's layout-pixel size (the caller measures the DOM and passes them in, so
// this stays pure + testable). No DOM here.

// the world-space rectangle currently visible for `cam`
export function viewRect(cam, cssW, cssH) {
  return { x: -cam.x / cam.z, y: -cam.y / cam.z, w: cssW / cam.z, h: cssH / cam.z };
}

// a cam that fits `rect` fully into the viewport, centred (zoom clamped to [lo,hi])
export function fitRect(rect, cssW, cssH, lo = 0.15, hi = 8) {
  const z = Math.max(lo, Math.min(hi, Math.min(cssW / rect.w, cssH / rect.h)));
  return { z, x: cssW / 2 - (rect.x + rect.w / 2) * z, y: cssH / 2 - (rect.y + rect.h / 2) * z };
}

// a cam centred on world point (wx,wy), keeping the current zoom
export function centerCam(cam, wx, wy, cssW, cssH) {
  return { ...cam, x: cssW / 2 - wx * cam.z, y: cssH / 2 - wy * cam.z };
}

// the padded bounding box of everything on the canvas — item `rects`, peer
// `cursors` (points, falsy skipped), and the local `view` rect — for the minimap.
// Falls back to a default box when there's nothing.
export function contentBounds(rects, cursors, view, pad = 80) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const b of rects || []) {
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  }
  for (const c of cursors || []) if (c) {
    minx = Math.min(minx, c.x); miny = Math.min(miny, c.y);
    maxx = Math.max(maxx, c.x); maxy = Math.max(maxy, c.y);
  }
  if (view) {
    minx = Math.min(minx, view.x); miny = Math.min(miny, view.y);
    maxx = Math.max(maxx, view.x + view.w); maxy = Math.max(maxy, view.y + view.h);
  }
  if (!isFinite(minx)) return { x: 0, y: 0, w: 1000, h: 1000 };
  return { x: minx - pad, y: miny - pad, w: maxx - minx + 2 * pad, h: maxy - miny + 2 * pad };
}

// a cam zoomed by `factor` about screen point (px,py), keeping that point fixed
export function zoomAt(cam, factor, px, py, lo = 0.15, hi = 8) {
  const z = Math.max(lo, Math.min(hi, cam.z * factor));
  const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z;
  return { z, x: px - wx * z, y: py - wy * z };
}
