import { useRef, render, html } from '../solid.js';

export default function mount(element) {
  const ref = element.ref;
  const data = useRef(ref);

  const cleanup = render(
    () =>
      html`<div
        style=${() => ({
          width: typeof data.width === 'number' ? `${data.width}px` : 'auto',
          height: typeof data.height === 'number' ? `${data.height}px` : 'auto',
          background: '#f1f5f9',
          'border-radius': '4px',
          overflow: 'hidden',
        })}
      >
        ${() => {
          const embedDocUrl = data.embedDocUrl;
          const embedToolUrl = data.embedToolUrl;
          return embedDocUrl && embedToolUrl
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
              </div>`;
        }}
      </div>`,
    element,
  );

  return cleanup;
}
