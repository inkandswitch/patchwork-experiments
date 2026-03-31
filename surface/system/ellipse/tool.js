
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
          background: '#8b5cf6',
          'border-radius': '50%',
        })}
      ></div>`,
    element,
  );
}
