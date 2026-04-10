import { render, html } from '../solid.js';

export default function mount(element) {
  const data = element.ref.value();
  const { embedDocUrl, embedToolUrl } = data;
  const width = data.width;
  const height = data.height;

  const cleanup = render(
    () =>
      html`<div
        style=${{
          width: width ? `${width}px` : 'auto',
          height: height ? `${height}px` : 'auto',
          background: '#f1f5f9',
          'border-radius': '4px',
          overflow: 'hidden',
        }}
      >
        ${embedDocUrl && embedToolUrl
          ? html`<ref-view
              ref-url=${embedDocUrl}
              view-url=${embedToolUrl}
              style=${{ display: 'block', width: '100%', height: '100%' }}
            />`
          : html`<div
              style=${{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                width: '100%',
                height: '100%',
                color: '#94a3b8',
                'font-size': '13px',
                'font-family': 'system-ui, -apple-system, sans-serif',
              }}
            >
              ${data.title || 'No content'}
            </div>`}
      </div>`,
    element,
  );

  return cleanup;
}
