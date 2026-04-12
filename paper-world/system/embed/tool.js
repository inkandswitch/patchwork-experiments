import { useRef, render, html } from '../solid.js';

const DEFAULT_EMBED_WIDTH = 420;
const DEFAULT_EMBED_HEIGHT = 320;

export default function mount(element) {
  const ref = element.ref;
  const data = useRef(ref);

  const cleanup = render(
    () =>
      html`<div
        style=${() => embedFrameStyle(data)}
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

function embedFrameStyle(data) {
  const hasExplicitWidth = typeof data.width === 'number';
  const hasExplicitHeight = typeof data.height === 'number';
  return {
    width: hasExplicitWidth ? `${data.width}px` : `min(${DEFAULT_EMBED_WIDTH}px, calc(100vw - 48px))`,
    height: hasExplicitHeight ? `${data.height}px` : `min(${DEFAULT_EMBED_HEIGHT}px, calc(100vh - 96px))`,
    'max-width': hasExplicitWidth ? 'none' : `${DEFAULT_EMBED_WIDTH}px`,
    'max-height': hasExplicitHeight ? 'none' : `${DEFAULT_EMBED_HEIGHT}px`,
    background: '#f1f5f9',
    'border-radius': '4px',
    overflow: 'hidden',
  };
}
