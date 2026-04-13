
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const TOOL_NAME = 'rainbow-marker';
const rainbowViewUrl = getViewUrl('./tool.json', import.meta.url);

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

  function onPointerDown(event) {
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    drawSurface = targetSurface;
    drawShapesRef = targetSurface.getOrCreate(surfaceSchema);
    const page = drawSurface.screenToPage(event.clientX, event.clientY);
    originX = page.x;
    originY = page.y;
    dragId = `rainbow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rootScale = surface.getScale();
    const drawScale = drawSurface.getScale();
    const strokeScale = rootScale / drawScale;
    drawShapesRef.at(dragId).change(() => ({
      viewUrl: rainbowViewUrl,
      data: { x: originX, y: originY, points: [[0, 0, event.pressure || 0.5]], strokeScale },
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
          border: active() ? '2px solid #f59e0b' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#fffbeb' : '#fff',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
          opacity: disabled ? '0.4' : '1',
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
    if (surface) {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
    }
    dispose();
  };
}
