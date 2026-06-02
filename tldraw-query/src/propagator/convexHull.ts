export interface Pt {
  x: number;
  y: number;
}

/**
 * Andrew's monotone-chain convex hull. Returns the hull vertices in
 * counter-clockwise order. For 0–2 input points it returns them as-is.
 */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;

  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Pt[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

/** Outward unit normal of the directed edge a->b for a CCW polygon. */
function outwardNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}

/**
 * Grow a convex polygon outward by a fixed `distance` (true offset, not a
 * scale): every edge moves out along its normal and each vertex becomes a
 * circular arc of radius `distance`, giving rounded corners. `samplesPerQuarter`
 * controls corner smoothness (points per 90° of turn).
 */
export function growHull(
  hull: Pt[],
  distance: number,
  samplesPerQuarter = 4
): Pt[] {
  const n = hull.length;
  if (n === 0 || distance <= 0) return hull;

  // Degenerate (1–2 points): offset radially from the centroid.
  if (n < 3) {
    const c = centroid(hull);
    return hull.map((p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * distance, y: p.y + (dy / len) * distance };
    });
  }

  const pts = signedArea(hull) < 0 ? hull.slice().reverse() : hull.slice();
  const out: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];

    const nIn = outwardNormal(prev, cur);
    const nOut = outwardNormal(cur, next);

    const a0 = Math.atan2(nIn.y, nIn.x);
    const a1 = Math.atan2(nOut.y, nOut.x);

    // Sweep CCW from the incoming edge normal to the outgoing edge normal.
    let delta = a1 - a0;
    while (delta < 0) delta += Math.PI * 2;
    while (delta > Math.PI * 2) delta -= Math.PI * 2;

    const steps = Math.max(
      1,
      Math.ceil((delta / (Math.PI / 2)) * samplesPerQuarter)
    );
    for (let s = 0; s <= steps; s++) {
      const a = a0 + delta * (s / steps);
      out.push({
        x: cur.x + Math.cos(a) * distance,
        y: cur.y + Math.sin(a) * distance,
      });
    }
  }

  return out;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function centroid(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}
