
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { selectedToolSchema, shapesSchema } from '../paper/schema.js';

const TOOL_NAME = 'rainbow-marker';
const rainbowViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const selectedToolRef = canvas.getOrCreate(selectedToolSchema);
  const selectedTool = from(selectedToolRef);
  const shapesRef = canvas.getOrCreate(shapesSchema);

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
    dragId = `rainbow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    shapesRef.at(dragId).change(() => ({
      x: originX,
      y: originY,
      viewUrl: rainbowViewUrl,
      points: [[0, 0, event.pressure || 0.5]],
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const rect = canvas.getBoundingClientRect();
    const relX = event.clientX - rect.left - originX;
    const relY = event.clientY - rect.top - originY;
    shapesRef.at(dragId).change((shape) => {
      shape.points.push([relX, relY, event.pressure || 0.5]);
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = shapesRef.at(dragId).value();
      if (shape.points.length < 3) {
        shapesRef.change((shapes) => {
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
          border: active() ? '2px solid #f59e0b' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#fffbeb' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
        title="Rainbow Marker"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <!-- Rainbow arc icon -->
          <path d="M3 14 Q3 5 9 5 Q15 5 15 14" stroke="#ff0000" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          <path d="M5 14 Q5 7.5 9 7.5 Q13 7.5 13 14" stroke="#ff8800" stroke-width="1.2" fill="none" stroke-linecap="round"/>
          <path d="M6.5 14 Q6.5 9.5 9 9.5 Q11.5 9.5 11.5 14" stroke="#ffdd00" stroke-width="1" fill="none" stroke-linecap="round"/>
          <path d="M7.8 14 Q7.8 11 9 11 Q10.2 11 10.2 14" stroke="#22cc44" stroke-width="0.8" fill="none" stroke-linecap="round"/>
          <!-- Small sparkle -->
          <circle cx="9" cy="4" r="1" fill="${() => active() ? '#f59e0b' : '#d4d4d8'}"/>
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
