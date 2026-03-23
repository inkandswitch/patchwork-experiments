import { render, html } from './solid.js';

const paperToolUrl = new URL('./paper/paper.js', import.meta.url).href;

export default function mount(element) {
  const refUrl = element.ref.url;
  return render(
    () =>
      html`<ref-view
        tool-url=${paperToolUrl}
        ref-url=${refUrl}
        style=${{
          display: 'block',
          width: '100%',
          height: '100%',
          minHeight: '0',
        }}
      />`,
    element,
  );
}
