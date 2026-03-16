import type { Ref } from '@automerge/automerge-repo';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';

export const schema = z.object({
  type: z.literal('rectangle'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number(),
  rotation: z.number().optional(),
  zIndex: z.number(),
});

export type RectangleShape = z.infer<typeof schema>;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function rectangleRefTool(
  ref: Ref<RectangleShape>,
  element: HTMLElement,
): () => void {
  return render(() => <RectangleView rectangleRef={ref} />, element);
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function RectangleView(props: { rectangleRef: Ref<RectangleShape> }) {
  const [shape, setShape] = createSignal<RectangleShape | undefined>(
    props.rectangleRef.value() as RectangleShape | undefined,
  );

  const cleanup = props.rectangleRef.onChange((value) => {
    setShape(value as RectangleShape | undefined);
  });

  // Unsubscribe when the Solid tree is torn down
  createEffect(() => cleanup);

  return (
    <>
      {shape() && (
        <svg width={shape()!.w} height={shape()!.h} style={{ overflow: 'visible' }}>
          <rect
            x={0}
            y={0}
            width={shape()!.w}
            height={shape()!.h}
            fill={shape()!.fill}
            stroke={shape()!.stroke}
            stroke-width={shape()!.strokeWidth}
            rx={4}
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
    id: 'paper-rectangle',
    name: 'Rectangle',
    schema,
    async load() {
      return rectangleRefTool;
    },
  },
];
