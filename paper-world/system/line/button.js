import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetCanvas, selectedToolSchema, shapesSchema } from '../paper/schema.js';
import { selectedColorSchema } from '../color-picker/schema.js';

const TOOL_NAME = 'line';
const lineViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const selectedColorRef = canvas.getOrCreate(selectedColorSchema);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let originX = 0;
  let originY = 0;
  let drawCanvas = null;
  let drawShapesRef = null;

  function onPointerDown(event) {
    if (!active()) return;
    const targetCanvas = findTargetCanvas(event.target, canvas);
    if (!targetCanvas) return;
    drawCanvas = targetCanvas;
    drawShapesRef = targetCanvas.getOrCreate(shapesSchema);
    const page = drawCanvas.screenToPage(event.clientX, event.clientY);
    originX = page.x;
    originY = page.y;
    dragId = `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = selectedColorRef.value();
    const rootScale = canvas.getScale();
    const drawScale = drawCanvas.getScale();
    const strokeScale = rootScale / drawScale;
    drawShapesRef.at(dragId).change(() => ({
      x: originX,
      y: originY,
      viewUrl: lineViewUrl,
      points: [[0, 0, event.pressure || 0.5]],
      color,
      strokeScale,
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const page = drawCanvas.screenToPage(event.clientX, event.clientY);
    const relX = page.x - originX;
    const relY = page.y - originY;
    drawShapesRef.at(dragId).change((shape) => {
      shape.points.push([relX, relY, event.pressure || 0.5]);
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = drawShapesRef.at(dragId).value();
      if (shape.points.length < 3) {
        drawShapesRef.change((shapes) => {
          delete shapes[dragId];
        });
      }
    }
    dragId = null;
    drawCanvas = null;
    drawShapesRef = null;
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
