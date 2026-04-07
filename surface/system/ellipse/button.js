
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { selectedToolSchema, shapesSchema } from '../paper/schema.js';

const TOOL_NAME = 'ellipse';
const ellipseViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  let startX = 0;
  let startY = 0;

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    dragId = `ellipse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    shapesRef.at(dragId).change(() => ({
      x: startX,
      y: startY,
      viewUrl: ellipseViewUrl,
      width: 0,
      height: 0,
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    shapesRef.at(dragId).change((shape) => {
      shape.x = x;
      shape.y = y;
      shape.width = width;
      shape.height = height;
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = shapesRef.at(dragId).value();
      if (shape.width < 2 && shape.height < 2) {
        const defaultWidth = 100;
        const defaultHeight = 100;
        shapesRef.at(dragId).change((s) => {
          s.x = startX - defaultWidth / 2;
          s.y = startY - defaultHeight / 2;
          s.width = defaultWidth;
          s.height = defaultHeight;
        });
      }
      selectedToolRef.change(() => '');
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
          border: active() ? '2px solid #8b5cf6' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#f5f3ff' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <ellipse cx="8" cy="8" rx="6" ry="5" stroke=${() => (active() ? '#8b5cf6' : '#71717a')} stroke-width="1.5" fill="none" />
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
