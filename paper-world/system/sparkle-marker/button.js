
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const TOOL_NAME = 'sparkle-marker';
const sparkleViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const disabled = !surface;
  const selectedToolRef = surface?.getOrCreate(selectedToolSchema);
  const selectedTool = selectedToolRef ? from(selectedToolRef) : () => '';

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    if (disabled) return;
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let originX = 0;
  let originY = 0;
  let drawSurface = null;
  let drawShapesRef = null;

  const colors = ['#f0abfc', '#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];

  function onPointerDown(event) {
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    drawSurface = targetSurface;
    drawShapesRef = targetSurface.getOrCreate(surfaceSchema);
    const page = drawSurface.screenToPage(event.clientX, event.clientY);
    originX = page.x;
    originY = page.y;
    dragId = `sparkle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rootScale = surface.getScale();
    const drawScale = drawSurface.getScale();
    const strokeScale = rootScale / drawScale;
    drawShapesRef.at(dragId).change(() => ({
      viewUrl: sparkleViewUrl,
      data: { x: originX, y: originY, points: [[0, 0, event.pressure || 0.5]], color, strokeScale },
    }));
    surface.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const page = drawSurface.screenToPage(event.clientX, event.clientY);
    const relX = page.x - originX;
    const relY = page.y - originY;
    drawShapesRef.at(dragId).change((shape) => {
      shape.data.points.push([relX, relY, event.pressure || 0.5]);
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = drawShapesRef.at(dragId).value();
      if (shape.data.points.length < 3) {
        drawShapesRef.change((shapes) => {
          delete shapes[dragId];
        });
      }
    }
    dragId = null;
    drawSurface = null;
    drawShapesRef = null;
  }

  if (surface) {
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);
  }

  const dispose = render(
    () =>
      html`<button
        disabled=${disabled}
        onPointerDown=${(e) => e.stopPropagation()}
        onClick=${toggleTool}
        style=${() => ({
          width: '32px',
          height: '32px',
          border: active() ? '2px solid #c084fc' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#faf5ff' : '#fff',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
          opacity: disabled ? '0.4' : '1',
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
    if (surface) {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
    }
    dispose();
  };
}
