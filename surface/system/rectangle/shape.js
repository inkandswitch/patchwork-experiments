import { from, render, html } from '../solid.js';
import { schema } from './schema.js';

export { schema };

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
