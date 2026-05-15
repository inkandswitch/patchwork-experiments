import type { Point } from '../types.ts';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

export function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area * 0.5);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function computeOverlayGeometry(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const videoAspect = videoWidth / videoHeight;
  const viewportAspect = viewportWidth / viewportHeight;
  if (videoAspect > viewportAspect) {
    const scale = viewportHeight / videoHeight;
    return { scale, offsetX: (viewportWidth - videoWidth * scale) * 0.5, offsetY: 0 };
  }
  const scale = viewportWidth / videoWidth;
  return { scale, offsetX: 0, offsetY: (viewportHeight - videoHeight * scale) * 0.5 };
}

export function projectPoint(
  point: Point,
  geometry: { scale: number; offsetX: number; offsetY: number },
) {
  return {
    x: point.x * geometry.scale + geometry.offsetX,
    y: point.y * geometry.scale + geometry.offsetY,
  };
}
