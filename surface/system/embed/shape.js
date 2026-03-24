import { from, render, html } from '../solid.js';
import { schema } from './schema.js';

export { schema };

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  const shapeId = element.ref.url.split('/').pop() ?? '';

  function embedDocUrl() {
    return data()?.embedDocUrl;
  }

  function embedToolUrl() {
    return data()?.embedToolUrl;
  }

  function embedWidth() {
    return `${data()?.width}px`;
  }

  function embedHeight() {
    return `${data()?.height}px`;
  }

  return render(
    () =>
      html`<div
        style=${() => ({
          display: 'flex',
          'flex-direction': 'column',
          width: embedWidth(),
          height: embedHeight(),
          background: '#fafafa',
          'border-radius': '6px',
          'box-shadow': '0 1px 6px rgba(0,0,0,0.14)',
          overflow: 'hidden',
          'box-sizing': 'border-box',
        })}
      >
        <div
          style=${{
            height: '30px',
            'flex-shrink': '0',
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            padding: '0 8px',
            background: 'rgba(0,0,0,0.04)',
            'border-bottom': '1px solid rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          <span
            style=${{
              flex: '1',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              font: '12px/1 system-ui, sans-serif',
              color: '#333',
            }}
            >${shapeId}</span
          >
        </div>
        <div
          style=${{
            flex: '1',
            overflow: 'hidden',
            'min-height': '0',
            position: 'relative',
          }}
          onPointerDown=${(e) => e.stopPropagation()}
        >
          ${() =>
            embedDocUrl()
              ? html`<ref-view
                  tool-url=${embedToolUrl}
                  ref-url=${embedDocUrl}
                  style="display:block;width:100%;height:100%;"
                />`
              : html`<div
                  style=${{
                    padding: '12px',
                    font: '12px system-ui, sans-serif',
                    color: '#71717a',
                  }}
                >
                  No embedded document
                </div>`}
        </div>
      </div>`,
    element,
  );
}
