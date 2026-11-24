/**
 * The AI's pen: shape primitives → point paths, optional hand-drawn wobble, and
 * drawing them over time so they read as gestures rather than stamps.
 * Coordinates are LM canvas px (the executor has already divided by the image scale).
 */
export interface Pt {
  x: number;
  y: number;
}

export type PenStyle = 'crisp' | 'hand-drawn';

/** Orange: distinct from the user's purple. */
export const AI_INK_COLOR = '#ff6a00';
export const AI_INK_WIDTH = 3.5;
/** Default drawing pace when a stroke has no duration. */
export const DEFAULT_PEN_SPEED = 400; // px/s
export const MIN_PEN_MS = 300;

export type PenShape =
  | { shape: 'polyline'; points: Pt[] }
  | { shape: 'circle'; center: Pt; r: number }
  | { shape: 'arrow'; from: Pt; to: Pt }
  | { shape: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { shape: 'underline'; from: Pt; to: Pt };

export function pathLength(path: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}

/** Points every `step` px along the path (always includes the last point). */
export function resample(path: readonly Pt[], step: number): Pt[] {
  if (path.length < 2) return path.slice();
  const out: Pt[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    let d = step - carry;
    while (d <= seg) {
      const f = d / seg;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = path[path.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

/** The point `s` px along the path (clamped). */
export function pointAt(path: readonly Pt[], s: number): Pt {
  if (path.length === 0) return { x: 0, y: 0 };
  if (s <= 0) return path[0];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= s) {
      const f = seg === 0 ? 0 : (s - acc) / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    acc += seg;
  }
  return path[path.length - 1];
}

/**
 * Hand-drawn wobble: resample finely, then push each point sideways by smooth
 * low-frequency noise (two sines with random phase) plus a touch of jitter.
 */
export function wobble(path: readonly Pt[], amp = 1.6, rnd: () => number = Math.random): Pt[] {
  const pts = resample(path, 5);
  if (pts.length < 3) return pts;
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const n = amp * (0.6 * Math.sin(s / 23 + p1) + 0.4 * Math.sin(s / 7 + p2)) + (rnd() - 0.5) * amp * 0.5;
    out.push({ x: pts[i].x + nx * n, y: pts[i].y + ny * n });
  }
  return out;
}

/** Each shape becomes one or more pen-down paths (an arrow is a shaft and a head). */
export function shapeToPaths(shape: PenShape, style: PenStyle = 'crisp', rnd: () => number = Math.random): Pt[][] {
  const hand = style === 'hand-drawn';
  let paths: Pt[][];
  switch (shape.shape) {
    case 'polyline':
      paths = [shape.points.slice()];
      break;
    case 'circle': {
      const { center: c, r } = shape;
      const n = 56;
      // Start at the top-left, go around once; hand-drawn overshoots a little and
      // breathes in radius, like a real circled thing.
      const start = -Math.PI * 0.6;
      const sweep = Math.PI * 2 * (hand ? 1.06 : 1);
      const phase = rnd() * Math.PI * 2;
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const a = start + (sweep * i) / n;
        const rr = hand ? r * (1 + 0.04 * Math.sin(3 * a + phase)) : r;
        pts.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
      }
      paths = [pts];
      break;
    }
    case 'arrow': {
      const { from, to } = shape;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const head = Math.min(18, Math.max(8, len * 0.3));
      const spread = Math.PI / 6.5;
      const wing = (sign: number): Pt => {
        const a = Math.atan2(uy, ux) + Math.PI + sign * spread;
        return { x: to.x + head * Math.cos(a), y: to.y + head * Math.sin(a) };
      };
      paths = [[from, to], [wing(1), to, wing(-1)]];
      break;
    }
    case 'box': {
      const { x0, y0, x1, y1 } = shape;
      paths = [
        [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
          { x: x0, y: y0 - (hand ? 3 : 0) },
        ],
      ];
      break;
    }
    case 'underline':
      paths = [[shape.from, shape.to]];
      break;
  }
  return hand ? paths.map((p) => wobble(p, 1.6, rnd)) : paths;
}

/** Natural duration for drawing these paths at the default pace. */
export function naturalDurationMs(paths: readonly Pt[][]): number {
  const total = paths.reduce((a, p) => a + pathLength(p), 0);
  return Math.max(MIN_PEN_MS, (total / DEFAULT_PEN_SPEED) * 1000);
}

/**
 * Draws a path over `durationMs`: emits the newly reached points each animation
 * frame (resampled ~3 px apart so the stroke stays smooth). Resolves when done or
 * when `isCanceled()` turns true.
 */
export function animatePath(
  path: readonly Pt[],
  durationMs: number,
  emit: (pts: Pt[]) => void,
  isCanceled: () => boolean = () => false,
  isFast: () => boolean = () => false,
): Promise<void> {
  const fine = resample(path, 3);
  const total = pathLength(path);
  if (fine.length === 0) return Promise.resolve();
  const raf: (cb: () => void) => void =
    typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);
  return new Promise((resolve) => {
    const start = performance.now();
    let next = 0;
    const tick = () => {
      if (isCanceled()) return resolve();
      const f = durationMs <= 0 || isFast() ? 1 : Math.min(1, (performance.now() - start) / durationMs);
      const reach = f * total;
      const batch: Pt[] = [];
      let acc = 0;
      for (let i = 0; i < fine.length; i++) {
        if (i > 0) acc += Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y);
        if (i >= next && (acc <= reach + 1e-6 || f >= 1)) {
          batch.push(fine[i]);
          next = i + 1;
        }
      }
      if (batch.length) emit(batch);
      if (f >= 1) return resolve();
      raf(tick);
    };
    tick();
  });
}
