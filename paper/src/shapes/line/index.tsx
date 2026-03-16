import type { Ref } from '@automerge/automerge-repo';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';

export const schema = z.object({
  type: z.literal('line'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  stroke: z.string(),
  strokeWidth: z.number(),
  zIndex: z.number(),
});

export type LineShape = z.infer<typeof schema>;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function lineRefTool(ref: Ref<LineShape>, element: HTMLElement): () => void {
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

  // Unsubscribe when the Solid tree is torn down
  createEffect(() => cleanup);

  const x = () => Math.min(shape()!.x1, shape()!.x2);
  const y = () => Math.min(shape()!.y1, shape()!.y2);
  const w = () => Math.max(1, Math.abs(shape()!.x2 - shape()!.x1));
  const h = () => Math.max(1, Math.abs(shape()!.y2 - shape()!.y1));

  return (
    <>
      {shape() && (
        <svg width={w()} height={h()} style={{ overflow: 'visible' }}>
          <line
            x1={shape()!.x1 - x()}
            y1={shape()!.y1 - y()}
            x2={shape()!.x2 - x()}
            y2={shape()!.y2 - y()}
            stroke={shape()!.stroke}
            stroke-width={shape()!.strokeWidth}
            stroke-linecap="round"
            stroke-dasharray="8 4"
          />
        </svg>
      )}
    </>
  );
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
