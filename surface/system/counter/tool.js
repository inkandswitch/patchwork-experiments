
import { from, render, html, createSignal } from '../solid.js';
import { schema } from './schema.js';

export { schema };

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  function increment() {
    ref.change((doc) => { doc.count = (doc.count || 0) + 1; });
  }

  function decrement() {
    ref.change((doc) => { doc.count = (doc.count || 0) - 1; });
  }

  function reset() {
    ref.change((doc) => { doc.count = 0; });
  }

  return render(
    () => html`
      <div style=${{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'border-radius': '12px',
        padding: '20px',
        'box-sizing': 'border-box',
        'font-family': 'system-ui, -apple-system, sans-serif',
        color: 'white',
        'user-select': 'none',
      }}>
        <div style=${{
          'font-size': '14px',
          'font-weight': '600',
          'letter-spacing': '2px',
          'text-transform': 'uppercase',
          'margin-bottom': '12px',
          opacity: '0.85',
        }}>Counter</div>
        <div style=${{
          'font-size': '56px',
          'font-weight': '700',
          'line-height': '1',
          'margin-bottom': '20px',
        }}>${() => data()?.count ?? 0}</div>
        <div style=${{
          display: 'flex',
          gap: '8px',
        }}>
          <button onClick=${decrement} style=${{
            width: '44px',
            height: '44px',
            'border-radius': '50%',
            border: '2px solid rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.15)',
            color: 'white',
            'font-size': '22px',
            cursor: 'pointer',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-weight': 'bold',
          }}>−</button>
          <button onClick=${reset} style=${{
            height: '44px',
            'border-radius': '22px',
            border: '2px solid rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.15)',
            color: 'white',
            'font-size': '13px',
            cursor: 'pointer',
            padding: '0 16px',
            'font-weight': '600',
          }}>Reset</button>
          <button onClick=${increment} style=${{
            width: '44px',
            height: '44px',
            'border-radius': '50%',
            border: '2px solid rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.15)',
            color: 'white',
            'font-size': '22px',
            cursor: 'pointer',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-weight': 'bold',
          }}>+</button>
        </div>
      </div>
    `,
    element,
  );
}
