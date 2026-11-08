// What a pwp layer keeps beside its pixels: the shapes they're drawn from, in
// cell coordinates (one patternwitch pixel is 1×1). Colours are palette
// indices, like patternwitch's own pixels.

export type Box = { x: number; y: number; w: number; h: number };

export type RectShape = Box & {
  id: string;
  kind: "rect" | "ellipse";
  color: number;
  fill: boolean;
  /** Outline width in cells, when not filled. */
  stroke: number;
};

export type StrokeShape = {
  id: string;
  kind: "line" | "pen";
  /** Flat x, y pairs. A line has two. */
  points: number[];
  color: number;
  stroke: number;
};

export type PictureShape = Box & {
  id: string;
  kind: "picture";
  /** The image as it was pasted, so it can be redrawn at any size. */
  bytes: Uint8Array;
  mime: string;
  dither: boolean;
};

export type Shape = RectShape | StrokeShape | PictureShape;
export type ShapeKind = Shape["kind"];

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isStroke(s: Shape): s is StrokeShape {
  return s.kind === "line" || s.kind === "pen";
}

export function bounds(s: Shape): Box {
  if (!isStroke(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.points.length; i += 2) {
    x0 = Math.min(x0, s.points[i]);
    x1 = Math.max(x1, s.points[i]);
    y0 = Math.min(y0, s.points[i + 1]);
    y1 = Math.max(y1, s.points[i + 1]);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function translate<S extends Shape>(s: S, dx: number, dy: number): S {
  if (isStroke(s)) {
    return { ...s, points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) };
  }
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/**
 * The box `from` with the edges `edges` names dragged by (dx, dy). Each of
 * `edges` is -1 (left/top), 1 (right/bottom) or 0 (that axis stays). A box
 * dragged through itself flips, and says so.
 */
export function dragBox(
  from: Box,
  edges: [number, number],
  dx: number,
  dy: number
): { box: Box; flipX: boolean; flipY: boolean } {
  let x0 = from.x, x1 = from.x + from.w;
  let y0 = from.y, y1 = from.y + from.h;
  if (edges[0] < 0) x0 += dx;
  if (edges[0] > 0) x1 += dx;
  if (edges[1] < 0) y0 += dy;
  if (edges[1] > 0) y1 += dy;
  const flipX = x1 < x0;
  const flipY = y1 < y0;
  return {
    box: {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    },
    flipX,
    flipY,
  };
}

/** `s` stretched from the box it's in to `to`. */
export function fitTo<S extends Shape>(
  s: S,
  to: Box,
  flipX = false,
  flipY = false
): S {
  if (!isStroke(s)) return { ...s, ...to };
  const from = bounds(s);
  const map = (v: number, o: number, len: number, no: number, nlen: number, flip: boolean) => {
    const t = len ? (v - o) / len : 0;
    return no + (flip ? 1 - t : t) * nlen;
  };
  return {
    ...s,
    points: s.points.map((v, i) =>
      i % 2
        ? map(v, from.y, from.h, to.y, to.h, flipY)
        : map(v, from.x, from.w, to.x, to.w, flipX)
    ),
  };
}

/** The box two corners span. */
export function spanBox(ax: number, ay: number, bx: number, by: number): Box {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** Drop points closer than `min` to the last one kept: a pen stroke's jitter. */
export function thin(points: number[], min = 0.35): number[] {
  if (points.length <= 4) return points;
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length; i += 2) {
    const last = out.length - 2;
    const d = Math.hypot(points[i] - out[last], points[i + 1] - out[last + 1]);
    if (d >= min || i === points.length - 2) out.push(points[i], points[i + 1]);
  }
  return out;
}

/** Whether a shape would draw anything at all. */
export function isEmpty(s: Shape): boolean {
  const b = bounds(s);
  if (isStroke(s)) return s.points.length < 2;
  return b.w <= 0 || b.h <= 0;
}

// Shapes on the clipboard: JSON, with a picture's bytes as base64.
export const CLIP_TYPE = "application/x-pwp+json";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export function toClip(shapes: readonly Shape[]): string {
  return JSON.stringify({
    pwp: 1,
    shapes: shapes.map((s) =>
      s.kind === "picture" ? { ...s, bytes: toBase64(s.bytes) } : s
    ),
  });
}

/** Shapes from the clipboard, each with a new id. Nothing if it isn't ours. */
export function fromClip(text: string): Shape[] {
  let data: { pwp?: number; shapes?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (data?.pwp !== 1 || !Array.isArray(data.shapes)) return [];
  return (data.shapes as (Shape & { bytes?: unknown })[]).map((s) =>
    s.kind === "picture"
      ? { ...s, id: newId(), bytes: fromBase64(String(s.bytes)) }
      : ({ ...s, id: newId() } as Shape)
  );
}
