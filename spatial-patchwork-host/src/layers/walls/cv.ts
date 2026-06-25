/**
 * Minimal pure-JS computer vision for the walls layer: threshold dark-on-light
 * blobs, label connected components (ignoring already-claimed mask pixels),
 * trace each component's outer contour, and simplify it. No dependencies.
 *
 * All coordinates are in downscaled-frame pixels.
 */

import type { FramePoint } from "../types.js";

/** Otsu's method: pick the grayscale threshold maximizing between-class variance. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * A binary "dark" mask: 1 where gray <= threshold (dark = foreground), EXCEPT
 * where `claimed`=1 (already taken by an earlier layer → forced background).
 */
export function buildDarkMask(
  gray: Uint8Array,
  threshold: number,
  claimed: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = claimed[i] ? 0 : gray[i] <= threshold ? 1 : 0;
  }
  return out;
}

/**
 * Foreground mask via background difference with HYSTERESIS, to keep thin marker
 * strokes solid instead of flickering. A pixel is "weak" foreground if it's at
 * least `deltaLo` darker than the empty-surface reference, "strong" if `deltaHi`
 * darker. We return `weak` (inclusive) here and use a strong map (below) to drop
 * components that contain no strong pixel — so faint noise doesn't register but a
 * stroke whose body is strong keeps its weaker edges. Excludes `claimed` pixels.
 *
 * @returns { weak, strong } — both length w*h, 1/0.
 */
export function buildForegroundMasks(
  gray: Uint8Array,
  background: Uint8Array,
  claimed: Uint8Array,
  deltaLo: number,
  deltaHi: number,
): { weak: Uint8Array; strong: Uint8Array } {
  const weak = new Uint8Array(gray.length);
  const strong = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    if (claimed[i]) continue;
    const d = background[i] - gray[i];
    if (d > deltaLo) {
      weak[i] = 1;
      if (d > deltaHi) strong[i] = 1;
    }
  }
  return { weak, strong };
}

/**
 * Morphological DILATE with a (2r+1)² square structuring element (returns a new
 * buffer). Bridges noise-broken gaps in thin marker strokes into one connected
 * component and thickens faint strokes so they survive — without the erode of a
 * full "close", which would eat thin lines (a few px wide) out of existence.
 * Growing the mask slightly is fine here (it only affects the recognized outline).
 */
export function dilateMask(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  return morph(src, w, h, r, true);
}

// dilate (max) when `grow`, else erode (min), over a square radius r.
function morph(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
  grow: boolean,
): Uint8Array {
  // Separable: horizontal pass then vertical pass.
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const pass = (
    inBuf: Uint8Array,
    outBuf: Uint8Array,
    horizontal: boolean,
  ) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let val = grow ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
            // Out-of-bounds treated as background (0).
            if (!grow) val = 0;
            continue;
          }
          const s = inBuf[yy * w + xx];
          if (grow) {
            if (s) {
              val = 1;
              break;
            }
          } else if (!s) {
            val = 0;
            break;
          }
        }
        outBuf[y * w + x] = val;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

export type Component = {
  label: number; // the value stored in `labels` for this component
  pixels: number; // area in px
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // a guaranteed boundary start pixel (topmost, then leftmost)
  startX: number;
  startY: number;
};

/**
 * Label connected dark components (4-connectivity) via BFS flood fill.
 * `labels[i]` = component index+1 (0 = background). Returns components with
 * area >= minArea.
 */
export function connectedComponents(
  bin: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h); // 0 = unlabeled/background
  const components: Component[] = [];
  const stack: number[] = [];
  let next = 1;

  for (let s = 0; s < bin.length; s++) {
    if (bin[s] === 0 || labels[s] !== 0) continue;
    const id = next++;
    stack.length = 0;
    stack.push(s);
    labels[s] = id;
    let pixels = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let startX = s % w;
    let startY = (s / w) | 0;

    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p / w) | 0;
      pixels++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // Track topmost-then-leftmost pixel as a stable contour start.
      if (y < startY || (y === startY && x < startX)) {
        startY = y;
        startX = x;
      }
      // 4-neighbors
      if (x > 0) {
        const q = p - 1;
        if (bin[q] && labels[q] === 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
      if (x < w - 1) {
        const q = p + 1;
        if (bin[q] && labels[q] === 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
      if (y > 0) {
        const q = p - w;
        if (bin[q] && labels[q] === 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
      if (y < h - 1) {
        const q = p + w;
        if (bin[q] && labels[q] === 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }

    if (pixels >= minArea) {
      components.push({ label: id, pixels, minX, minY, maxX, maxY, startX, startY });
    }
  }

  return { labels, components };
}

/**
 * Moore-neighbor boundary tracing of a single component's outer contour. `inside`
 * tests whether a pixel belongs to the component. Starts at a known boundary
 * pixel (topmost-leftmost) and walks the boundary clockwise back to the start.
 */
export function traceContour(
  startX: number,
  startY: number,
  w: number,
  h: number,
  inside: (x: number, y: number) => boolean,
): FramePoint[] {
  // 8-neighborhood offsets, clockwise from East.
  const N8 = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contour: FramePoint[] = [];
  let cx = startX;
  let cy = startY;
  // Backtrack direction: came from the west of the start (index 4).
  let backDir = 4;
  const maxSteps = w * h * 4;
  let steps = 0;
  const firstX = cx;
  const firstY = cy;
  let secondX = -1;
  let secondY = -1;

  do {
    contour.push({ x: cx, y: cy });
    // Search clockwise starting just after the backtrack direction.
    let found = false;
    const startSearch = (backDir + 1) % 8;
    for (let k = 0; k < 8; k++) {
      const dir = (startSearch + k) % 8;
      const nx = cx + N8[dir][0];
      const ny = cy + N8[dir][1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && inside(nx, ny)) {
        // The new backtrack points from the neighbor back toward current.
        backDir = (dir + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    if (secondX === -1) {
      secondX = cx;
      secondY = cy;
    } else if (cx === firstX && cy === firstY) {
      // Returned to start; Jacob's stopping criterion (start revisited).
      break;
    }
  } while (++steps < maxSteps);

  return contour;
}

/** Ramer–Douglas–Peucker polygon simplification. */
export function simplify(points: FramePoint[], epsilon: number): FramePoint[] {
  if (points.length < 3) return points.slice();

  const sqEps = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxSq = 0;
    let index = -1;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      // Perpendicular squared distance from p to segment a-b.
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      const projX = a.x + t * dx;
      const projY = a.y + t * dy;
      const ddx = p.x - projX;
      const ddy = p.y - projY;
      const sq = ddx * ddx + ddy * ddy;
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (maxSq > sqEps && index !== -1) {
      keep[index] = 1;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }

  const out: FramePoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
