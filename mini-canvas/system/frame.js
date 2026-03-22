import { z } from 'https://esm.sh/zod@4.3';
import { from } from 'https://esm.sh/solid-js@1.9';
import { render } from 'https://esm.sh/solid-js@1.9/web';
import html from 'https://esm.sh/solid-js@1.9/html';

const ShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

const FrameSchema = z.object({
  shapes: z.record(z.string(), ShapeSchema.passthrough()),
});

export const schema = {
  init() {
    return {
      shapes: {
        rect1: { x: 50, y: 50, toolUrl: new URL('./rectangle.js', import.meta.url).href, width: 200, height: 120 },
      },
    };
  },
  parse(value) {
    return FrameSchema.parse(value);
  },
};

export default function mount(element) {
  const ref = element.ref.as(schema);
  const shapes = from(ref.at('shapes'));

  return render(
    () =>
      html`<div style=${{ position: 'relative', width: '100%', height: '100%' }}>
        ${() => {
          const entries = Object.entries(shapes() ?? {});
          return entries.map(
            ([id, shape]) =>
              html`<div
                style=${{ position: 'absolute', left: `${shape.x}px`, top: `${shape.y}px` }}
              >
                <ref-view
                  tool-url=${shape.toolUrl}
                  ref-url=${ref.at('shapes', id).url}
                />
              </div>`,
          );
        }}
      </div>`,
    element,
  );
}
