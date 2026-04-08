import { render, html } from './solid.js';
import { getViewUrl } from './url.js';

const stackViewUrl = getViewUrl('./stack/tool.json', import.meta.url);

export default function mount(element) {
  const refUrl = element.refUrl;
  return render(
    () =>
      html`<ref-view
        view-url=${stackViewUrl}
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
