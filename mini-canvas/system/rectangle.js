import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from './solid.js';

const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  width: z.number(),
  height: z.number(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./rectangle.js', import.meta.url).href, width: 100, height: 100 };
  },
  parse(value) {
    return RectangleSchema.parse(value);
  },
};

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  return render(
    () =>
      html`<div
        style=${() => ({
          width: `${data()?.width}px`,
          height: `${data()?.height}px`,
          background: '#3b82f6',
          'border-radius': '4px',
        })}
      ></div>`,
    element,
  );
}
