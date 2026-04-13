
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetCanvas, selectedToolSchema, shapesSchema } from '../paper/schema.js';

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
  let originX = 0;
  let originY = 0;
  let drawCanvas = null;
  let drawShapesRef = null;

  const colors = ['#f0abfc', '#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];

  function onPointerDown(event) {
    if (!active()) return;
    const targetCanvas = findTargetCanvas(event.target, canvas);
    if (!targetCanvas) return;
    drawCanvas = targetCanvas;
    drawShapesRef = targetCanvas.getOrCreate(shapesSchema);
    const page = drawCanvas.screenToPage(event.clientX, event.clientY);
    originX = page.x;
    originY = page.y;
    dragId = `sparkle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rootScale = canvas.getScale();
    const drawScale = drawCanvas.getScale();
    const strokeScale = rootScale / drawScale;
    drawShapesRef.at(dragId).change(() => ({
      x: originX,
      y: originY,
      viewUrl: sparkleViewUrl,
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
