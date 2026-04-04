
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';

const TOOL_NAME = 'sparkle-marker';
const sparkleViewUrl = getViewUrl('./tool.json', import.meta.url);

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

  // Pick a random sparkly color each stroke
  const colors = ['#f0abfc', '#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    originX = event.clientX - rect.left;
    originY = event.clientY - rect.top;
    dragId = `sparkle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = colors[Math.floor(Math.random() * colors.length)];
    canvas.ref.at('shapes', dragId).change(() => ({
      x: originX,
      y: originY,
      viewUrl: sparkleViewUrl,
      points: [[0, 0, event.pressure || 0.5]],
      color: color,
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
          border: active() ? '2px solid #c084fc' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#faf5ff' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
        title="Sparkle Marker"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <!-- Sparkle star icon -->
          <path d="M8 1 L9.2 5.5 L14 6.5 L10 9.5 L11 14 L8 11 L5 14 L6 9.5 L2 6.5 L6.8 5.5 Z"
            fill=${() => active() ? '#c084fc' : '#a1a1aa'}
            stroke=${() => active() ? '#a855f7' : '#71717a'}
            stroke-width="0.5"
          />
          <!-- Small sparkle dots -->
          <circle cx="3" cy="3" r="0.8" fill=${() => active() ? '#f0abfc' : '#d4d4d8'} />
          <circle cx="13" cy="2" r="0.6" fill=${() => active() ? '#818cf8' : '#d4d4d8'} />
          <circle cx="14" cy="12" r="0.7" fill=${() => active() ? '#38bdf8' : '#d4d4d8'} />
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
