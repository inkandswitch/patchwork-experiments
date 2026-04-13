import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';
import { selectedColorSchema } from '../color-picker/schema.js';

const TOOL_NAME = 'rectangle';
const rectangleViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const selectedColorRef = surface?.getOrCreate(selectedColorSchema);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    if (disabled) return;
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  let dragId = null;
  let startX = 0;
  let startY = 0;
  let drawSurface = null;
  let drawShapesRef = null;

  function onPointerDown(event) {
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    drawSurface = targetSurface;
    drawShapesRef = targetSurface.getOrCreate(surfaceSchema);
    const page = drawSurface.screenToPage(event.clientX, event.clientY);
    startX = page.x;
    startY = page.y;
    dragId = `rect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = selectedColorRef.value();
    drawShapesRef.at(dragId).change(() => ({
      viewUrl: rectangleViewUrl,
      data: { x: startX, y: startY, width: 0, height: 0, color },
    }));
    surface.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const { x: currentX, y: currentY } = drawSurface.screenToPage(event.clientX, event.clientY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    drawShapesRef.at(dragId).change((shape) => {
      shape.data.x = x;
      shape.data.y = y;
      shape.data.width = width;
      shape.data.height = height;
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = drawShapesRef.at(dragId).value();
      if (shape.data.width < 2 && shape.data.height < 2) {
        const defaultWidth = 100;
        const defaultHeight = 80;
        drawShapesRef.at(dragId).change((s) => {
          s.data.x = startX - defaultWidth / 2;
          s.data.y = startY - defaultHeight / 2;
          s.data.width = defaultWidth;
          s.data.height = defaultHeight;
        });
      }
      selectedToolRef.change(() => '');
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
          border: active() ? '2px solid #3b82f6' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#eff6ff' : '#fff',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
          opacity: disabled ? '0.4' : '1',
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="4" width="12" height="8" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.5" fill="none" />
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
