import { from, render, html } from '../solid.js';
import rectangleSchema from './schema.js';



export default function mount(element) {
  const ref = element.getOrCreate(rectangleSchema);
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
