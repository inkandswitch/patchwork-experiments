import type { Ref } from '@automerge/automerge-repo';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { getStroke } from 'perfect-freehand';
import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';
import type { Rect, ShapeElement } from '../../paper/types.js';

export const schema = z.object({
  type: z.literal('line'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  points: z.array(z.tuple([z.number(), z.number()])),
  stroke: z.string(),
  strokeWidth: z.number(),
  zIndex: z.number(),
});

export type LineShape = z.infer<typeof schema>;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function lineRefTool(ref: Ref<LineShape>, element: HTMLElement): () => void {
  (element as ShapeElement).doesShapeOverlapWith = (rect: Rect) => {
    const shape = ref.value() as LineShape | undefined;
    if (!shape) return false;
    const localRect = { x: rect.x - shape.x, y: rect.y - shape.y, w: rect.w, h: rect.h };
    return strokeOverlapsRect(shape.points, localRect);
  };
  return render(() => <LineView lineRef={ref} />, element);
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function LineView(props: { lineRef: Ref<LineShape> }) {
  const [shape, setShape] = createSignal<LineShape | undefined>(
    props.lineRef.value() as LineShape | undefined,
  );

  const cleanup = props.lineRef.onChange((value) => {
    setShape(value as LineShape | undefined);
  });

  createEffect(() => cleanup);

  const w = () => {
    const pts = shape()?.points;
    if (!pts?.length) return 1;
    return Math.max(1, Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])));
  };

  const h = () => {
    const pts = shape()?.points;
    if (!pts?.length) return 1;
    return Math.max(1, Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])));
  };

  const pathData = () => {
    const s = shape();
    if (!s?.points.length) return '';
    const relativePoints = s.points.map(([px, py]) => [px, py]);
    const outlinePoints = getStroke(relativePoints, {
      size: s.strokeWidth * 3,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      last: true,
    });
    return getSvgPathFromStroke(outlinePoints);
  };

  return (
    <>
      {shape() && (
        <svg
          width={w() + shape()!.strokeWidth * 3}
          height={h() + shape()!.strokeWidth * 3}
          style={{ overflow: 'visible' }}
        >
          <path d={pathData()} fill={shape()!.stroke} />
        </svg>
      )}
    </>
  );
}

// ─── SVG path helper ──────────────────────────────────────────────────────────

function getSvgPathFromStroke(points: number[][]): string {
  if (points.length < 4) return '';

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result =
    `M${a[0].toFixed(2)},${a[1].toFixed(2)} ` +
    `Q${b[0].toFixed(2)},${b[1].toFixed(2)} ` +
    `${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = points.length - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }

  return result + 'Z';
}

function avg(a: number, b: number): number {
  return (a + b) / 2;
}

// ─── doesShapeOverlapWith helpers ─────────────────────────────────────────────

function strokeOverlapsRect(points: [number, number][], rect: Rect): boolean {
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    if (pointInRect(px, py, rect)) return true;
    if (i < points.length - 1 && segmentIntersectsRect(points[i], points[i + 1], rect)) {
      return true;
    }
  }
  return false;
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function segmentIntersectsRect(a: [number, number], b: [number, number], rect: Rect): boolean {
  const { x, y, w, h } = rect;
  return (
    segmentsIntersect(a, b, [x, y], [x + w, y]) ||
    segmentsIntersect(a, b, [x + w, y], [x + w, y + h]) ||
    segmentsIntersect(a, b, [x + w, y + h], [x, y + h]) ||
    segmentsIntersect(a, b, [x, y + h], [x, y])
  );
}

function segmentsIntersect(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  [x3, y3]: [number, number],
  [x4, y4]: [number, number],
): boolean {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:ref-tool' as const,
    id: 'paper-line',
    name: 'Line',
    schema,
    async load() {
      return lineRefTool;
    },
  },
];
