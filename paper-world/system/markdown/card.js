import { z } from 'https://esm.sh/zod@4.3';
import { render, html, createSignal } from '../solid.js';
import { surfaceSchema } from '../surface/schema.js';
import { editorExtensionsSchema } from '../text/schema.js';
import { markdownPreview } from './preview.js';

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const schema = {
  init() {
    return { x: 0, y: 0 };
  },
  parse(value) {
    return ButtonShapeSchema.parse(value);
  },
};

export default function mount(element) {
  const surface = element.findParent(surfaceSchema);
  if (!surface) return;

  const [enabled, setEnabled] = createSignal(true);
  const extension = markdownPreview();

  applyToAll(element, extension);

  function onMounted(event) {
    if (!enabled()) return;
    const refView = event.target?.closest('ref-view');
    if (refView?.has(editorExtensionsSchema)) {
      refView.addExtension(element, extension);
    }
  }

  surface.addEventListener('mounted', onMounted);

  function flipCorner(onClick) {
    return html`<div
      onClick=${onClick}
      style=${{
        position: 'absolute',
        top: '4px',
        left: '4px',
        width: '18px',
        height: '18px',
        'z-index': '10',
        cursor: 'pointer',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'border-radius': '4px',
        opacity: '0.4',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter=${(e) => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave=${(e) => { e.currentTarget.style.opacity = '0.4'; }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 7.5 C2 4, 4 2, 7.5 2" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" fill="none" />
        <polyline points="5.5,1 7.5,2 5.5,3" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>`;
  }

  const cardStyle = {
    width: '140px',
    height: '196px',
    'border-radius': '10px',
    border: '2px solid #e2e8f0',
    background: '#fff',
    'box-shadow': '0 2px 8px rgba(0,0,0,0.08)',
    display: 'flex',
    'flex-direction': 'column',
    overflow: 'hidden',
    'font-family': 'system-ui, -apple-system, sans-serif',
    'user-select': 'none',
    'backface-visibility': 'hidden',
    position: 'absolute',
    inset: '0',
  };

  const HIGHLIGHT_STYLE = 'outline: 2px solid rgba(139, 92, 246, 0.5); outline-offset: 2px; border-radius: 4px;';

  function highlightTargets() {
    for (const target of element.findAll(editorExtensionsSchema)) {
      target.style.cssText += HIGHLIGHT_STYLE;
    }
  }

  function unhighlightTargets() {
    for (const target of element.findAll(editorExtensionsSchema)) {
      target.style.outline = '';
      target.style.outlineOffset = '';
    }
  }

  const cleanup = render(
    () =>
      html`<div
        style=${{ width: '140px', height: '196px', perspective: '600px' }}
        onMouseEnter=${() => enabled() && highlightTargets()}
        onMouseLeave=${unhighlightTargets}
      >
        <div
          style=${() => ({
            position: 'relative',
            width: '100%',
            height: '100%',
            'transform-style': 'preserve-3d',
            'transform-origin': 'center',
            transition: 'transform 0.5s',
            transform: enabled() ? 'rotateY(0deg)' : 'rotateY(180deg)',
          })}
        >
          <!-- front face -->
          <div style=${cardStyle}>
            ${flipCorner((e) => {
              e.stopPropagation();
              setEnabled(false);
              removeFromAll(element);
            })}
            <div
              style=${{
                flex: '1',
                background: 'linear-gradient(135deg, #f0fdf4 0%, #f0f9ff 50%, #faf5ff 100%)',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
              }}
            >
              <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
                <rect x="10" y="6" width="52" height="60" rx="6" fill="#fff" stroke="#cbd5e1" stroke-width="1.5" />
                <path d="M24 26 L24 46 M24 26 L30 34 L36 26 M36 26 L36 46" stroke="#1e293b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M44 34 L44 46 M44 42 L48 46 L44 42 L40 46" stroke="#1e293b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <div
              style=${{
                padding: '8px 10px',
                'border-top': '1px solid #f1f5f9',
                background: '#fafafa',
                'font-size': '11px',
                color: '#64748b',
                'line-height': '1.3',
              }}
            >
              Markdown formatting
            </div>
          </div>
          <!-- back face -->
          <div
            style=${{
              ...cardStyle,
              transform: 'rotateY(180deg)',
              background: '#f1f5f9',
              border: '2px solid #e2e8f0',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '8px',
            }}
          >
            ${flipCorner((e) => {
              e.stopPropagation();
              setEnabled(true);
              applyToAll(element, extension);
            })}
            <svg width="40" height="40" viewBox="0 0 72 72" fill="none" style="opacity:0.3">
              <rect x="10" y="6" width="52" height="60" rx="6" stroke="#94a3b8" stroke-width="2" fill="none" />
              <path d="M24 26 L24 46 M24 26 L30 34 L36 26 M36 26 L36 46" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M44 34 L44 46 M44 42 L48 46 L44 42 L40 46" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div style=${{ 'font-size': '12px', color: '#94a3b8', 'font-weight': '500' }}>Markdown</div>
          </div>
        </div>
      </div>`,
    element,
  );

  return () => {
    surface.removeEventListener('mounted', onMounted);
    removeFromAll(element);
    cleanup();
  };
}

function applyToAll(caller, extension) {
  const targets = caller.findAll(editorExtensionsSchema);
  for (const target of targets) {
    target.addExtension(caller, extension);
  }
}

function removeFromAll(caller) {
  const targets = caller.findAll(editorExtensionsSchema);
  for (const target of targets) {
    target.removeExtension(caller);
  }
}
