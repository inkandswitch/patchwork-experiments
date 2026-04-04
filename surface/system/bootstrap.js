import { render, html } from './solid.js';
import { getViewUrl } from './url.js';

const paperViewUrl = getViewUrl('./paper/tool.json', import.meta.url);

export default function mount(element) {
  const refUrl = element.ref.url;
  return render(
    () =>
      html`<ref-view
        view-url=${paperViewUrl}
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
