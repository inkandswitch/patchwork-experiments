import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html, createSignal } from '../solid.js';
import { getViewUrl } from '../url.js';
import { shapesSchema } from '../paper/schema.js';
import { selectedColorSchema } from './schema.js';

const COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#1a1a1a',
];

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, viewUrl: getViewUrl('./button.json', import.meta.url) };
  },
  parse(value) {
    return ButtonShapeSchema.parse(value);
  },
};

export default function mount(element) {
  const canvas = element.findParent(shapesSchema);
  if (!canvas) return;
  const selectedColorRef = canvas.getOrCreate(selectedColorSchema);
  const selectedColor = from(selectedColorRef);
  const [open, setOpen] = createSignal(false);

  function pickColor(color) {
    selectedColorRef.change(() => color);
    setOpen(false);
  }

  function toggleOpen(event) {
    event.stopPropagation();
    setOpen(!open());
  }

  return render(
    () =>
      html`<div style=${{ position: 'relative', display: 'inline-block' }}>
        <button
          onPointerDown=${(e) => e.stopPropagation()}
          onClick=${toggleOpen}
          style=${() => ({
            width: '32px',
            height: '32px',
            border: open() ? '2px solid #3b82f6' : '1px solid #d4d4d8',
            'border-radius': '6px',
            background: '#fff',
            cursor: 'pointer',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            padding: '0',
          })}
        >
          <div
            style=${() => ({
              width: '16px',
              height: '16px',
              'border-radius': '50%',
              background: selectedColor() ?? '#3b82f6',
              border: '1.5px solid rgba(0,0,0,0.15)',
            })}
          ></div>
        </button>
        ${() =>
          open()
            ? html`<div
                onPointerDown=${(e) => e.stopPropagation()}
                style=${{
                  position: 'absolute',
                  bottom: '38px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#fff',
                  border: '1px solid #d4d4d8',
                  'border-radius': '8px',
                  padding: '6px',
                  display: 'grid',
                  'grid-template-columns': 'repeat(5, 1fr)',
                  gap: '4px',
                  'box-shadow': '0 4px 12px rgba(0,0,0,0.12)',
                  'z-index': '1000',
                }}
              >
                ${COLORS.map(
                  (color) =>
                    html`<button
                      onClick=${() => pickColor(color)}
                      style=${() => ({
                        width: '24px',
                        height: '24px',
                        'border-radius': '50%',
                        background: color,
                        border:
                          selectedColor() === color
                            ? '2.5px solid #0f172a'
                            : '1.5px solid rgba(0,0,0,0.1)',
                        cursor: 'pointer',
                        padding: '0',
                        transition: 'transform 0.1s ease',
                      })}
                    ></button>`,
                )}
              </div>`
            : ''}
      </div>`,
    element,
  );
}
