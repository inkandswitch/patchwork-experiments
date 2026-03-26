import { render, html } from './solid.js';
import { getToolUrl } from './url.js';

const paperToolUrl = getToolUrl('./paper/paper.js', import.meta.url);

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
