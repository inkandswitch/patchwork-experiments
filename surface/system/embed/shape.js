import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';

const EmbedSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    toolUrl: z.string(),
    embedToolUrl: z.string(),
    width: z.number(),
    height: z.number(),
    embedDocUrl: z.string().default(''),
  })
  .passthrough();

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: new URL('./shape.js', import.meta.url).href,
      embedToolUrl: '',
      width: 200,
      height: 150,
      embedDocUrl: '',
    };
  },
  parse(value) {
    return EmbedSchema.parse(value);
  },
};

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  const shapeId = element.ref.url.split('/').pop() ?? '';

  return render(
    () =>
      html`<div
        style=${() => ({
          display: 'flex',
          'flex-direction': 'column',
          width: `${data()?.width}px`,
          height: `${data()?.height}px`,
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
            data()?.embedDocUrl
              ? html`<ref-view
                  tool-url=${() => data()?.embedToolUrl}
                  ref-url=${() => data()?.embedDocUrl}
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
