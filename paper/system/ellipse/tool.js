
import { from, render, html } from '../solid.js';
import ellipseSchema from './schema.js';



export default function mount(element) {
  const ref = element.getOrCreate(ellipseSchema);
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
