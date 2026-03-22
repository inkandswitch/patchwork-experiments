import { z } from 'https://esm.sh/zod@4.3';
import { useRef, For, render, html } from './solid.js';

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
        rectButton: { x: 10, y: 10, toolUrl: new URL('./rectangle-button.js', import.meta.url).href },
      },
    };
  },
  parse(value) {
    return FrameSchema.parse(value);
  },
};

export default function mount(element) {
  const ref = element.ref.as(schema);
  const shapes = useRef(ref.at('shapes'));

  return render(
    () =>
      html`<div style=${{ position: 'relative', width: '100%', height: '100%' }}>
        <${For} each=${() => Object.keys(shapes)}>${(id) =>
          html`<div
            style=${() => ({ position: 'absolute', left: `${shapes[id]?.x}px`, top: `${shapes[id]?.y}px` })}
          >
            <ref-view
              tool-url=${() => shapes[id]?.toolUrl}
              ref-url=${ref.at('shapes', id).url}
            />
          </div>`
        }</>
      </div>`,
    element,
  );
}
