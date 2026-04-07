import { from, render, html } from '../solid.js';
import jsonSchema from './schema.js';



export default function mount(element) {
  const ref = element.getOrCreate(jsonSchema);
  const data = from(ref);

  return render(
    () =>
      html`<pre
        style=${{
          margin: '0',
          padding: '12px',
          'font-family': 'ui-monospace, monospace',
          'font-size': '12px',
          'line-height': '1.5',
          'white-space': 'pre-wrap',
          'word-break': 'break-all',
          overflow: 'auto',
          width: '100%',
          height: '100%',
          'box-sizing': 'border-box',
          background: '#fafafa',
          color: '#1e1e1e',
        }}
      >${() => JSON.stringify(data(), null, 2)}</pre>`,
    element,
  );
}
