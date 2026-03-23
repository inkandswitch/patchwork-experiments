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
        selectionButton: { x: 10, y: 10, toolUrl: new URL('./selection/button.js', import.meta.url).href },
        rectButton: { x: 50, y: 10, toolUrl: new URL('./rectangle/button.js', import.meta.url).href },
        lineButton: { x: 90, y: 10, toolUrl: new URL('./line/button.js', import.meta.url).href },
        textButton: { x: 130, y: 10, toolUrl: new URL('./text/button.js', import.meta.url).href },
        embedButton: { x: 170, y: 10, toolUrl: new URL('./embed/button.js', import.meta.url).href },
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
  const selectedShapes = useRef(ref.at('selectedShapes'));

  return render(
    () =>
      html`<div style=${{ position: 'relative', width: '100%', height: '100%' }}>
        <${For} each=${() => Object.keys(shapes)}>${(id) =>
          html`<div
            style=${() => ({
              position: 'absolute',
              left: `${shapes[id]?.x}px`,
              top: `${shapes[id]?.y}px`,
              filter: selectedShapes[id] ? 'drop-shadow(0 0 3px rgba(0,0,0,0.4))' : 'none',
            })}
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
