import type { Embed, SpaceTimeDoc } from '../types';
import type { CanvasLayout } from './layout';
import { pointInPolygon, pointInRect } from './layout';

/** Ephemeral multi-selection (not stored in Automerge). */
export type CanvasSelection = {
  clipIds: string[];
  playheadIds: string[];
  scribbleIds: string[];
  postItIds: string[];
  inlineImageIds: string[];
  embedIds: string[];
};

export type SelectionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A solid region that contributes to the selection bubble. */
export type SelectionShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: number[][] };

export const EMPTY_SELECTION: CanvasSelection = {
  clipIds: [],
  playheadIds: [],
  scribbleIds: [],
  postItIds: [],
  inlineImageIds: [],
  embedIds: [],
};

/** Outward padding around each selected item (page px). */
export const SELECTION_BUBBLE_PAD = 12;
/** Corner roundness / smooth-union blend (page px). */
export const SELECTION_BUBBLE_RADIUS = 22;
/** Half-width of bridges that keep far-apart items in one bubble. */
const SELECTION_BUBBLE_BRIDGE = 10;

export function selectionIsEmpty(sel: CanvasSelection): boolean {
  return (
    sel.clipIds.length === 0 &&
    sel.playheadIds.length === 0 &&
    sel.scribbleIds.length === 0 &&
    sel.postItIds.length === 0 &&
    sel.inlineImageIds.length === 0 &&
    sel.embedIds.length === 0
  );
}

export function selectionCount(sel: CanvasSelection): number {
  return (
    sel.clipIds.length +
    sel.playheadIds.length +
    sel.scribbleIds.length +
    sel.postItIds.length +
    sel.inlineImageIds.length +
    sel.embedIds.length
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const adx = dx - ax;
  const ady = dy - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const cax = ax - cx;
  const cay = ay - cy;
  const cbx = bx - cx;
  const cby = by - cy;
  const cross1 = abx * acy - aby * acx;
  const cross2 = abx * ady - aby * adx;
  const cross3 = cdx * cay - cdy * cax;
  const cross4 = cdx * cby - cdy * cbx;
  if (cross1 === 0 && cross2 === 0 && cross3 === 0 && cross4 === 0) {
    const overlapX = Math.max(ax, bx) >= Math.min(cx, dx) && Math.min(ax, bx) <= Math.max(cx, dx);
    const overlapY = Math.max(ay, by) >= Math.min(cy, dy) && Math.min(ay, by) <= Math.max(cy, dy);
    return overlapX && overlapY;
  }
  return cross1 * cross2 <= 0 && cross3 * cross4 <= 0;
}

/** Axis-aligned rect intersects a closed polygon (intersection, not containment). */
export function rectIntersectsPolygon(
  rect: SelectionBounds,
  polygon: readonly number[][],
): boolean {
  if (polygon.length < 3 || rect.width <= 0 || rect.height <= 0) return false;
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
  for (const [x, y] of corners) {
    if (pointInPolygon(x, y, polygon as number[][])) return true;
  }
  for (const pt of polygon) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    if (pointInRect(x, y, rect)) return true;
  }
  const edges: Array<[number, number, number, number]> = [
    [rect.x, rect.y, rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height],
    [rect.x, rect.y + rect.height, rect.x, rect.y],
  ];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const ax = a[0];
    const ay = a[1];
    const bx = b[0];
    const by = b[1];
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    for (const [ex0, ey0, ex1, ey1] of edges) {
      if (segmentsIntersect(ax, ay, bx, by, ex0, ey0, ex1, ey1)) return true;
    }
  }
  return false;
}

function rectEdges(rect: SelectionBounds): Array<[number, number, number, number]> {
  return [
    [rect.x, rect.y, rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height],
    [rect.x, rect.y + rect.height, rect.x, rect.y],
  ];
}

function polygonEdgesCross(
  a: readonly number[][],
  b: readonly number[][],
): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    const ax0 = a0[0];
    const ay0 = a0[1];
    const ax1 = a1[0];
    const ay1 = a1[1];
    if (ax0 === undefined || ay0 === undefined || ax1 === undefined || ay1 === undefined) continue;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      const bx0 = b0[0];
      const by0 = b0[1];
      const bx1 = b1[0];
      const by1 = b1[1];
      if (bx0 === undefined || by0 === undefined || bx1 === undefined || by1 === undefined) continue;
      if (segmentsIntersect(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1)) return true;
    }
  }
  return false;
}

/**
 * True if the axis-aligned rect lies fully inside the polygon.
 * Corners must be inside, and rect edges must not cross the polygon boundary
 * (so a concave lasso can't leave a mid-edge outside).
 */
export function rectContainedInPolygon(
  rect: SelectionBounds,
  polygon: readonly number[][],
): boolean {
  if (polygon.length < 3 || rect.width <= 0 || rect.height <= 0) return false;
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];
  for (const [x, y] of corners) {
    if (!pointInPolygon(x, y, polygon as number[][])) return false;
  }
  const edges = rectEdges(rect);
  for (const [ex0, ey0, ex1, ey1] of edges) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const ax = a[0];
      const ay = a[1];
      const bx = b[0];
      const by = b[1];
      if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
      if (segmentsIntersect(ex0, ey0, ex1, ey1, ax, ay, bx, by)) return false;
    }
  }
  return true;
}

/** True if every vertex of `inner` is inside `outer` and no edges cross. */
export function polygonContainedInPolygon(
  inner: readonly number[][],
  outer: readonly number[][],
): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  for (const pt of inner) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    if (!pointInPolygon(x, y, outer as number[][])) return false;
  }
  return !polygonEdgesCross(inner, outer);
}

/** Two polygons intersect (shared area or crossing edges). */
export function polygonIntersectsPolygon(
  a: readonly number[][],
  b: readonly number[][],
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const pt of a) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    if (pointInPolygon(x, y, b as number[][])) return true;
  }
  for (const pt of b) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    if (pointInPolygon(x, y, a as number[][])) return true;
  }
  return polygonEdgesCross(a, b);
}

export function playheadExtentBounds(ph: CanvasLayout['playheads'][number]): SelectionBounds {
  const left = Math.min(ph.x, ph.currentX);
  const right = Math.max(ph.maxEndX, ph.currentX);
  return { x: left, y: ph.y, width: Math.max(1, right - left), height: ph.height };
}

export function scribbleBounds(outline: number[][]): SelectionBounds | null {
  if (outline.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of outline) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Solid shapes for every selected item (rects + scribble outlines). */
export function selectionItemShapes(
  layout: CanvasLayout,
  selection: CanvasSelection,
  embeds: readonly Embed[] | undefined,
): SelectionShape[] {
  const out: SelectionShape[] = [];
  const clipSet = new Set(selection.clipIds);
  for (const clip of layout.clips) {
    if (!clipSet.has(clip.clipId)) continue;
    out.push({ kind: 'rect', x: clip.x, y: clip.y, width: clip.width, height: clip.height });
  }
  const phSet = new Set(selection.playheadIds);
  for (const ph of layout.playheads) {
    if (!phSet.has(ph.playheadId)) continue;
    const b = playheadExtentBounds(ph);
    out.push({ kind: 'rect', ...b });
  }
  const scribbleSet = new Set(selection.scribbleIds);
  for (const scribble of layout.scribbles) {
    if (!scribbleSet.has(scribble.scribbleId)) continue;
    if (scribble.outline.length >= 3) {
      out.push({ kind: 'polygon', points: scribble.outline });
    }
  }
  const postItSet = new Set(selection.postItIds);
  for (const postIt of layout.postIts) {
    if (!postItSet.has(postIt.postItId)) continue;
    out.push({
      kind: 'rect',
      x: postIt.x,
      y: postIt.y,
      width: postIt.width,
      height: postIt.height,
    });
  }
  const imageSet = new Set(selection.inlineImageIds);
  for (const image of layout.inlineImages) {
    if (!imageSet.has(image.imageId)) continue;
    out.push({
      kind: 'rect',
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    });
  }
  const embedSet = new Set(selection.embedIds);
  for (const embed of embeds ?? []) {
    if (!embedSet.has(embed.id)) continue;
    out.push({
      kind: 'rect',
      x: embed.x,
      y: embed.y,
      width: embed.width,
      height: embed.height,
    });
  }
  return out;
}

/** @deprecated Prefer selectionItemShapes + buildSelectionBubblePolygon. */
export function selectionItemBounds(
  layout: CanvasLayout,
  selection: CanvasSelection,
  embeds: readonly Embed[] | undefined,
): SelectionBounds[] {
  return selectionItemShapes(layout, selection, embeds).map((shape) => {
    if (shape.kind === 'rect') {
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    }
    return scribbleBounds(shape.points) ?? { x: 0, y: 0, width: 0, height: 0 };
  });
}

export function inflateBounds(b: SelectionBounds, pad: number): SelectionBounds {
  return {
    x: b.x - pad,
    y: b.y - pad,
    width: b.width + pad * 2,
    height: b.height + pad * 2,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smoothMin(a: number, b: number, k: number): number {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/** Signed distance to a rounded axis-aligned rect (negative inside). */
function sdRoundedRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): number {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hx = Math.max(0, w / 2);
  const hy = Math.max(0, h / 2);
  const radius = Math.min(r, hx, hy);
  const dx = Math.abs(px - cx) - (hx - radius);
  const dy = Math.abs(py - cy) - (hy - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - radius;
}

/** Signed distance to a closed polygon (negative inside). */
function sdPolygon(px: number, py: number, points: readonly number[][]): number {
  if (points.length < 3) return Infinity;
  let inside = false;
  let minDistSq = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i]!;
    const pj = points[j]!;
    const xi = pi[0]!;
    const yi = pi[1]!;
    const xj = pj[0]!;
    const yj = pj[1]!;

    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }

    const ex = xj - xi;
    const ey = yj - yi;
    const lenSq = ex * ex + ey * ey;
    const t = lenSq > 0 ? clamp(((px - xi) * ex + (py - yi) * ey) / lenSq, 0, 1) : 0;
    const cx = xi + ex * t - px;
    const cy = yi + ey * t - py;
    minDistSq = Math.min(minDistSq, cx * cx + cy * cy);
  }
  const dist = Math.sqrt(minDistSq);
  return inside ? -dist : dist;
}

function sdCapsule(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const lenSq = bax * bax + bay * bay;
  const t = lenSq > 0 ? clamp((pax * bax + pay * bay) / lenSq, 0, 1) : 0;
  return Math.hypot(pax - bax * t, pay - bay * t) - radius;
}

function shapeCentroid(shape: SelectionShape): [number, number] {
  if (shape.kind === 'rect') {
    return [shape.x + shape.width / 2, shape.y + shape.height / 2];
  }
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const pt of shape.points) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    sx += x;
    sy += y;
    n++;
  }
  if (n === 0) return [0, 0];
  return [sx / n, sy / n];
}

function closestPointOnShape(shape: SelectionShape, px: number, py: number): [number, number] {
  if (shape.kind === 'rect') {
    return [
      clamp(px, shape.x, shape.x + shape.width),
      clamp(py, shape.y, shape.y + shape.height),
    ];
  }
  let bestX = shape.points[0]?.[0] ?? px;
  let bestY = shape.points[0]?.[1] ?? py;
  let bestD = Infinity;
  // Sample outline vertices (dense enough from perfect-freehand).
  for (const pt of shape.points) {
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < bestD) {
      bestD = d;
      bestX = x;
      bestY = y;
    }
  }
  return [bestX, bestY];
}

function closestPoints(
  a: SelectionShape,
  b: SelectionShape,
): { ax: number; ay: number; bx: number; by: number; dist: number } {
  const [acx, acy] = shapeCentroid(a);
  const [bcx, bcy] = shapeCentroid(b);
  const [ax, ay] = closestPointOnShape(a, bcx, bcy);
  const [bx, by] = closestPointOnShape(b, acx, acy);
  // Refine once toward each other.
  const [ax2, ay2] = closestPointOnShape(a, bx, by);
  const [bx2, by2] = closestPointOnShape(b, ax2, ay2);
  return {
    ax: ax2,
    ay: ay2,
    bx: bx2,
    by: by2,
    dist: Math.hypot(bx2 - ax2, by2 - ay2),
  };
}

type Bridge = { ax: number; ay: number; bx: number; by: number; r: number };

/** MST corridors so far-apart items still form one connected bubble. */
function selectionBridges(shapes: readonly SelectionShape[]): Bridge[] {
  if (shapes.length < 2) return [];
  const n = shapes.length;
  const edges: Array<{ i: number; j: number; dist: number; link: Bridge }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = closestPoints(shapes[i]!, shapes[j]!);
      edges.push({
        i,
        j,
        dist: c.dist,
        link: { ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, r: SELECTION_BUBBLE_BRIDGE },
      });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const bridges: Bridge[] = [];
  let joined = 0;
  for (const e of edges) {
    const ri = find(e.i);
    const rj = find(e.j);
    if (ri === rj) continue;
    parent[ri] = rj;
    joined++;
    // Skip near-zero bridges; smooth-union already merges overlapping pads.
    if (e.dist > SELECTION_BUBBLE_PAD * 0.5) bridges.push(e.link);
    if (joined >= n - 1) break;
  }
  return bridges;
}

function distanceToShape(
  shape: SelectionShape,
  px: number,
  py: number,
  pad: number,
  radius: number,
): number {
  if (shape.kind === 'rect') {
    return sdRoundedRect(
      px,
      py,
      shape.x - pad,
      shape.y - pad,
      shape.width + pad * 2,
      shape.height + pad * 2,
      radius,
    );
  }
  return sdPolygon(px, py, shape.points) - pad;
}

function selectionField(
  px: number,
  py: number,
  shapes: readonly SelectionShape[],
  bridges: readonly Bridge[],
  pad: number,
  radius: number,
): number {
  let d = Infinity;
  for (const shape of shapes) {
    d = smoothMin(d, distanceToShape(shape, px, py, pad, radius), radius);
  }
  for (const bridge of bridges) {
    d = smoothMin(d, sdCapsule(px, py, bridge.ax, bridge.ay, bridge.bx, bridge.by, bridge.r), radius);
  }
  return d;
}

function shapeBounds(shape: SelectionShape): SelectionBounds {
  if (shape.kind === 'rect') {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  return scribbleBounds(shape.points) ?? { x: 0, y: 0, width: 0, height: 0 };
}

function chaikin(points: number[][], iterations: number): number[][] {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    if (pts.length < 3) break;
    const next: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const ax = a[0]!;
      const ay = a[1]!;
      const bx = b[0]!;
      const by = b[1]!;
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    pts = next;
  }
  return pts;
}

/**
 * Marching-squares contour of the selection SDF, then Chaikin-smoothed into
 * one soft bubble polygon. Always connected (MST bridges between items).
 */
export function buildSelectionBubblePolygon(
  shapes: readonly SelectionShape[],
  pad: number = SELECTION_BUBBLE_PAD,
  radius: number = SELECTION_BUBBLE_RADIUS,
): number[][] | null {
  if (shapes.length === 0) return null;

  const bridges = selectionBridges(shapes);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const b = shapeBounds(shape);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  for (const bridge of bridges) {
    minX = Math.min(minX, bridge.ax, bridge.bx);
    minY = Math.min(minY, bridge.ay, bridge.by);
    maxX = Math.max(maxX, bridge.ax, bridge.bx);
    maxY = Math.max(maxY, bridge.ay, bridge.by);
  }
  const margin = pad + radius + SELECTION_BUBBLE_BRIDGE + 4;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const targetCells = 140;
  const cell = Math.max(2.5, Math.max(width, height) / targetCells);
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;

  const field = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + col * cell;
      const y = minY + row * cell;
      field[row * cols + col] = selectionField(x, y, shapes, bridges, pad, radius);
    }
  }

  // Collect oriented edge segments from marching squares (iso = 0).
  type Seg = { x0: number; y0: number; x1: number; y1: number };
  const segs: Seg[] = [];
  const lerp = (a: number, b: number, va: number, vb: number) => {
    const t = Math.abs(vb - va) < 1e-9 ? 0.5 : clamp(-va / (vb - va), 0, 1);
    return a + (b - a) * t;
  };

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const i00 = row * cols + col;
      const v00 = field[i00]!;
      const v10 = field[i00 + 1]!;
      const v01 = field[i00 + cols]!;
      const v11 = field[i00 + cols + 1]!;
      const x0 = minX + col * cell;
      const y0 = minY + row * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;

      let code = 0;
      if (v00 <= 0) code |= 1;
      if (v10 <= 0) code |= 2;
      if (v11 <= 0) code |= 4;
      if (v01 <= 0) code |= 8;
      if (code === 0 || code === 15) continue;

      const top: [number, number] = [lerp(x0, x1, v00, v10), y0];
      const right: [number, number] = [x1, lerp(y0, y1, v10, v11)];
      const bottom: [number, number] = [lerp(x0, x1, v01, v11), y1];
      const left: [number, number] = [x0, lerp(y0, y1, v00, v01)];

      const add = (a: [number, number], b: [number, number]) => {
        segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
      };

      // Standard marching-squares edge connections (ambiguous cases: 5 & 10).
      switch (code) {
        case 1:
        case 14:
          add(left, top);
          break;
        case 2:
        case 13:
          add(top, right);
          break;
        case 3:
        case 12:
          add(left, right);
          break;
        case 4:
        case 11:
          add(right, bottom);
          break;
        case 6:
        case 9:
          add(top, bottom);
          break;
        case 7:
        case 8:
          add(left, bottom);
          break;
        case 5:
          add(left, top);
          add(right, bottom);
          break;
        case 10:
          add(top, right);
          add(bottom, left);
          break;
        default:
          break;
      }
    }
  }

  if (segs.length === 0) return null;

  // Stitch segments into closed rings; keep the largest by area.
  const used = new Uint8Array(segs.length);
  const rings: number[][][] = [];
  const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    const ring: number[][] = [];
    let x = segs[start]!.x0;
    let y = segs[start]!.y0;
    let cx = segs[start]!.x1;
    let cy = segs[start]!.y1;
    used[start] = 1;
    ring.push([x, y]);
    ring.push([cx, cy]);

    for (let guard = 0; guard < segs.length + 2; guard++) {
      let found = -1;
      const want = key(cx, cy);
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        const s = segs[i]!;
        if (key(s.x0, s.y0) === want) {
          found = i;
          cx = s.x1;
          cy = s.y1;
          break;
        }
        if (key(s.x1, s.y1) === want) {
          found = i;
          cx = s.x0;
          cy = s.y0;
          break;
        }
      }
      if (found < 0) break;
      used[found] = 1;
      ring.push([cx, cy]);
      if (key(cx, cy) === key(ring[0]![0]!, ring[0]![1]!)) break;
    }

    if (ring.length >= 4) rings.push(ring);
  }

  if (rings.length === 0) return null;

  let best = rings[0]!;
  let bestArea = -1;
  for (const ring of rings) {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      area += a[0]! * b[1]! - b[0]! * a[1]!;
    }
    area = Math.abs(area) * 0.5;
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }

  // Drop duplicate closing vertex if present, then smooth.
  if (best.length > 1) {
    const first = best[0]!;
    const last = best[best.length - 1]!;
    if (Math.hypot(first[0]! - last[0]!, first[1]! - last[1]!) < 1e-3) {
      best = best.slice(0, -1);
    }
  }

  return chaikin(best, 2);
}

/** True if page point lies inside the selection bubble polygon. */
export function pointInSelectionBubble(
  pageX: number,
  pageY: number,
  bubble: readonly number[][] | null | undefined,
): boolean {
  if (!bubble || bubble.length < 3) return false;
  return pointInPolygon(pageX, pageY, bubble as number[][]);
}

/** Build the bubble polygon for the current selection. */
export function selectionBubblePolygon(
  layout: CanvasLayout,
  selection: CanvasSelection,
  embeds: readonly Embed[] | undefined,
): number[][] | null {
  if (selectionIsEmpty(selection)) return null;
  return buildSelectionBubblePolygon(selectionItemShapes(layout, selection, embeds));
}

/** Build a selection from a freehand lasso polygon (closed). Full containment. */
export function selectionFromLasso(
  layout: CanvasLayout,
  doc: SpaceTimeDoc,
  polygon: readonly number[][],
): CanvasSelection {
  if (polygon.length < 3) return { ...EMPTY_SELECTION };

  const clipIds: string[] = [];
  for (const clip of layout.clips) {
    if (
      rectContainedInPolygon(
        { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
        polygon,
      )
    ) {
      clipIds.push(clip.clipId);
    }
  }

  // Playhead only if its entire extent band is inside the lasso — so you can
  // lasso clips inside a playhead without selecting the playhead itself.
  const playheadIds: string[] = [];
  for (const ph of layout.playheads) {
    if (rectContainedInPolygon(playheadExtentBounds(ph), polygon)) {
      playheadIds.push(ph.playheadId);
    }
  }

  const scribbleIds: string[] = [];
  for (const scribble of layout.scribbles) {
    if (scribble.outline.length >= 3 && polygonContainedInPolygon(scribble.outline, polygon)) {
      scribbleIds.push(scribble.scribbleId);
    }
  }

  const postItIds: string[] = [];
  for (const postIt of layout.postIts) {
    if (
      rectContainedInPolygon(
        { x: postIt.x, y: postIt.y, width: postIt.width, height: postIt.height },
        polygon,
      )
    ) {
      postItIds.push(postIt.postItId);
    }
  }

  const inlineImageIds: string[] = [];
  for (const image of layout.inlineImages) {
    if (
      rectContainedInPolygon(
        { x: image.x, y: image.y, width: image.width, height: image.height },
        polygon,
      )
    ) {
      inlineImageIds.push(image.imageId);
    }
  }

  const embedIds: string[] = [];
  for (const embed of doc.embeds ?? []) {
    if (
      rectContainedInPolygon(
        { x: embed.x, y: embed.y, width: embed.width, height: embed.height },
        polygon,
      )
    ) {
      embedIds.push(embed.id);
    }
  }

  return { clipIds, playheadIds, scribbleIds, postItIds, inlineImageIds, embedIds };
}
