import { z } from 'https://esm.sh/zod@4.3';
import { from } from 'https://esm.sh/solid-js@1.9';
import { render } from 'https://esm.sh/solid-js@1.9/web';
import html from 'https://esm.sh/solid-js@1.9/html';

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
          width: `${data()?.width ?? 100}px`,
          height: `${data()?.height ?? 100}px`,
          background: '#3b82f6',
          borderRadius: '4px',
        })}
      ></div>`,
    element,
  );
}
