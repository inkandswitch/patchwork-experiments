import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from './solid.js';

const TOOL_NAME = 'rectangle';
const rectangleToolUrl = new URL('./rectangle.js', import.meta.url).href;

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./rectangle-button.js', import.meta.url).href };
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
  console.log('[rect-button] mount', element);
  const canvas = element.parent;
  console.log('[rect-button] canvas parent', canvas);
  const selectedToolRef = canvas.ref.at('selectedTool').as(selectedToolSchema);
  const selectedTool = from(selectedToolRef);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    console.log('[rect-button] toggleTool', { was: selectedTool(), next });
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let startX = 0;
  let startY = 0;

  function onPointerDown(event) {
    console.log('[rect-button] pointerdown', { active: active(), target: event.target });
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    dragId = `rect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log('[rect-button] creating shape', dragId, { x: startX, y: startY });
    canvas.ref.at('shapes', dragId).change(() => ({
      x: startX,
      y: startY,
      toolUrl: rectangleToolUrl,
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
    console.log('[rect-button] pointermove', dragId, { x, y, width, height });
    canvas.ref.at('shapes', dragId).change((shape) => {
      shape.x = x;
      shape.y = y;
      shape.width = width;
      shape.height = height;
    });
  }

  function onPointerUp() {
    console.log('[rect-button] pointerup', { dragId });
    if (dragId) {
      const shape = canvas.ref.at('shapes', dragId).value();
      console.log('[rect-button] final shape', dragId, shape);
      if (shape.width < 2 && shape.height < 2) {
        const defaultWidth = 100;
        const defaultHeight = 80;
        canvas.ref.at('shapes', dragId).change((s) => {
          s.x = startX - defaultWidth / 2;
          s.y = startY - defaultHeight / 2;
          s.width = defaultWidth;
          s.height = defaultHeight;
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
          <rect x="2" y="4" width="12" height="8" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.5" fill="none" />
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
