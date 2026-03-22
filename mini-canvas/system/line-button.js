import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from './solid.js';

const TOOL_NAME = 'line';
const lineToolUrl = new URL('./line.js', import.meta.url).href;

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./line-button.js', import.meta.url).href };
  },
  parse(value) {
    return ButtonShapeSchema.parse(value);
  },
};

const selectedToolSchema = {
  init() {
    return '';
  },
  parse(value) {
    return typeof value === 'string' ? value : '';
  },
};

export default function mount(element) {
  const canvas = element.parent;
  const selectedToolRef = canvas.ref.at('selectedTool').as(selectedToolSchema);
  const selectedTool = from(selectedToolRef);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let originX = 0;
  let originY = 0;

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    originX = event.clientX - rect.left;
    originY = event.clientY - rect.top;
    dragId = `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    canvas.ref.at('shapes', dragId).change(() => ({
      x: originX,
      y: originY,
      toolUrl: lineToolUrl,
      points: [[0, 0, event.pressure || 0.5]],
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const rect = canvas.getBoundingClientRect();
    const relX = event.clientX - rect.left - originX;
    const relY = event.clientY - rect.top - originY;
    canvas.ref.at('shapes', dragId).change((shape) => {
      shape.points.push([relX, relY, event.pressure || 0.5]);
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = canvas.ref.at('shapes', dragId).value();
      if (shape.points.length < 3) {
        canvas.ref.at('shapes').change((shapes) => {
          delete shapes[dragId];
        });
      }
    }
    dragId = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  const dispose = render(
    () =>
      html`<button
        onPointerDown=${(e) => e.stopPropagation()}
        onClick=${toggleTool}
        style=${() => ({
          width: '32px',
          height: '32px',
          border: active() ? '2px solid #3b82f6' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#eff6ff' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 13 Q6 5 9 8 Q12 11 13 3" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.5" fill="none" stroke-linecap="round" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    dispose();
  };
}
