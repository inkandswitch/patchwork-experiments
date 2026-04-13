
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const TOOL_NAME = 'eraser';
const eraserViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const shapesRef = surface?.getOrCreate(surfaceSchema);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    if (disabled) return;
    selectedToolRef.change(() => active() ? '' : TOOL_NAME);
  }

  let dragging = false;
  let trailId = null;
  let trailPoints = [];
  let currentStrokeScale = 1;
  const ERASER_RADIUS = 18;

  // Track which shapes we've already erased so we don't try to delete twice
  let erasedIds = new Set();

  let drawSurface = null;
  let drawShapesRef = null;

  function getCanvasPos(event) {
    return (drawSurface || surface).screenToPage(event.clientX, event.clientY);
  }

  function eraseAtPoint(px, py) {
    const ref = drawShapesRef || shapesRef;
    const shapes = ref.value() || {};
    const toDelete = [];
    const scaledRadius = ERASER_RADIUS * currentStrokeScale;

    for (const [id, shape] of Object.entries(shapes)) {
      const d = shape.data;
      if (d?.isLocked) continue;
      if (erasedIds.has(id)) continue;
      if (id === trailId) continue;
      if (shape.viewUrl && shape.viewUrl.includes('eraser/tool.json')) continue;

      const sx = d?.x || 0;
      const sy = d?.y || 0;

      if (d?.points && d.points.length > 0) {
        for (const pt of d.points) {
          const ptx = sx + (pt[0] || 0);
          const pty = sy + (pt[1] || 0);
          const dist = Math.sqrt((px - ptx) ** 2 + (py - pty) ** 2);
          if (dist < scaledRadius + 8 * currentStrokeScale) {
            toDelete.push(id);
            break;
          }
        }
      } else if (d?.width && d?.height) {
        const inX = px >= sx - scaledRadius && px <= sx + d.width + scaledRadius;
        const inY = py >= sy - scaledRadius && py <= sy + d.height + scaledRadius;
        if (inX && inY) {
          toDelete.push(id);
        }
      } else if (d?.text !== undefined) {
        const tw = Math.max(50, (d.text || '').length * 8);
        const th = 24;
        const inX = px >= sx - scaledRadius && px <= sx + tw + scaledRadius;
        const inY = py >= sy - scaledRadius && py <= sy + th + scaledRadius;
        if (inX && inY) {
          toDelete.push(id);
        }
      }
    }

    if (toDelete.length > 0) {
      const ref = drawShapesRef || shapesRef;
      ref.change((shapes) => {
        for (const id of toDelete) {
          delete shapes[id];
          erasedIds.add(id);
        }
      });
    }
  }

  function onPointerDown(event) {
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    drawSurface = targetSurface;
    drawShapesRef = targetSurface.getOrCreate(surfaceSchema);

    const rootScale = surface.getScale();
    const drawScale = drawSurface.getScale();
    currentStrokeScale = rootScale / drawScale;

    dragging = true;
    erasedIds = new Set();
    const pos = getCanvasPos(event);
    trailPoints = [[pos.x, pos.y]];
    trailId = `eraser_trail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    drawShapesRef.at(trailId).change(() => ({
      viewUrl: eraserViewUrl,
      data: { x: 0, y: 0, points: [[pos.x, pos.y]], strokeScale: currentStrokeScale, createdAt: Date.now() },
    }));

    surface.setPointerCapture(event.pointerId);
    eraseAtPoint(pos.x, pos.y);
  }

  function onPointerMove(event) {
    if (!dragging || !trailId) return;
    const pos = getCanvasPos(event);
    trailPoints.push([pos.x, pos.y]);

    drawShapesRef.at(trailId).change((shape) => {
      shape.data.points.push([pos.x, pos.y]);
    });

    eraseAtPoint(pos.x, pos.y);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;

    const id = trailId;
    if (id && drawShapesRef) {
      try {
        drawShapesRef.change((shapes) => {
          delete shapes[id];
        });
      } catch(e) {}
    }

    trailId = null;
    trailPoints = [];
    erasedIds = new Set();
    currentStrokeScale = 1;
    drawSurface = null;
    drawShapesRef = null;
  }

  let cursorEl = null;

  if (surface) {
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);

    cursorEl = document.createElement('div');
    cursorEl.style.cssText = `
      position: fixed; pointer-events: none; z-index: 99999;
      width: ${ERASER_RADIUS * 2}px; height: ${ERASER_RADIUS * 2}px;
      border: 2px solid rgba(150, 150, 180, 0.7);
      border-radius: 50%;
      background: rgba(220, 220, 240, 0.2);
      transform: translate(-50%, -50%);
      display: none;
      box-shadow: 0 0 8px rgba(150, 150, 180, 0.3);
    `;
    document.body.appendChild(cursorEl);
  }

  function onGlobalMove(e) {
    if (!cursorEl || !surface) return;
    if (active()) {
      cursorEl.style.display = 'block';
      cursorEl.style.left = e.clientX + 'px';
      cursorEl.style.top = e.clientY + 'px';
      surface.style.cursor = 'none';
    } else {
      cursorEl.style.display = 'none';
      surface.style.cursor = '';
    }
  }
  if (surface) {
    document.addEventListener('pointermove', onGlobalMove);
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
          border: active() ? '2px solid #94a3b8' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#f1f5f9' : '#fff',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
          opacity: disabled ? '0.4' : '1',
        })}
        title="Eraser"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <!-- Eraser icon -->
          <rect x="2" y="8" width="10" height="5" rx="1.5"
            transform="rotate(-35 7 10.5)"
            fill=${() => active() ? '#cbd5e1' : '#e4e4e7'}
            stroke=${() => active() ? '#64748b' : '#a1a1aa'}
            stroke-width="1.2"
          />
          <rect x="7" y="6" width="6" height="5" rx="0.5"
            transform="rotate(-35 10 8.5)"
            fill=${() => active() ? '#f8fafc' : '#f4f4f5'}
            stroke=${() => active() ? '#64748b' : '#a1a1aa'}
            stroke-width="1.2"
          />
          <line x1="3" y1="14" x2="13" y2="14"
            stroke=${() => active() ? '#64748b' : '#a1a1aa'}
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>`,
    element,
  );

  return () => {
    if (surface) {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointermove', onGlobalMove);
      surface.style.cursor = '';
    }
    if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
    dispose();
  };
}
