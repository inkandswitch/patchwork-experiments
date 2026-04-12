import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetCanvas, selectedToolSchema, shapesSchema } from '../paper/schema.js';

const TOOL_NAME = 'rectangle';
const rectangleViewUrl = getViewUrl('./tool.json', import.meta.url);

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

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let startX = 0;
  let startY = 0;
  let drawCanvas = null;
  let drawShapesRef = null;

  function onPointerDown(event) {
    if (!active()) return;
    const targetCanvas = findTargetCanvas(event.target, canvas);
    if (!targetCanvas) return;
    drawCanvas = targetCanvas;
    drawShapesRef = targetCanvas.getOrCreate(shapesSchema);
    const page = drawCanvas.screenToPage(event.clientX, event.clientY);
    startX = page.x;
    startY = page.y;
    dragId = `rect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    drawShapesRef.at(dragId).change(() => ({
      x: startX,
      y: startY,
      viewUrl: rectangleViewUrl,
      width: 0,
      height: 0,
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const { x: currentX, y: currentY } = drawCanvas.screenToPage(event.clientX, event.clientY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    drawShapesRef.at(dragId).change((shape) => {
      shape.x = x;
      shape.y = y;
      shape.width = width;
      shape.height = height;
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = drawShapesRef.at(dragId).value();
      if (shape.width < 2 && shape.height < 2) {
        const defaultWidth = 100;
        const defaultHeight = 80;
        drawShapesRef.at(dragId).change((s) => {
          s.x = startX - defaultWidth / 2;
          s.y = startY - defaultHeight / 2;
          s.width = defaultWidth;
          s.height = defaultHeight;
        });
      }
      selectedToolRef.change(() => '');
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
