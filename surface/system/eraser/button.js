
import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getToolUrl } from '../url.js';

const TOOL_NAME = 'eraser';
const eraserToolUrl = getToolUrl('./tool.js', import.meta.url);

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: getToolUrl('./button.js', import.meta.url) };
  },
  parse(value) {
    return ButtonShapeSchema.parse(value);
  },
};

const selectedToolSchema = {
  init() { return ''; },
  parse(value) { return typeof value === 'string' ? value : ''; },
};

export default function mount(element) {
  const canvas = element.parent;
  const selectedToolRef = canvas.ref.at('selectedTool').as(selectedToolSchema);
  const selectedTool = from(selectedToolRef);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    selectedToolRef.change(() => active() ? '' : TOOL_NAME);
  }

  let dragging = false;
  let trailId = null;
  let trailPoints = [];
  const ERASER_RADIUS = 18;

  // Track which shapes we've already erased so we don't try to delete twice
  let erasedIds = new Set();

  function getCanvasPos(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function eraseAtPoint(px, py) {
    const doc = canvas.ref.value();
    const shapes = doc.shapes || {};
    const toDelete = [];

    for (const [id, shape] of Object.entries(shapes)) {
      // Don't erase locked shapes (toolbar buttons), eraser trails, or self
      if (shape.isLocked) continue;
      if (erasedIds.has(id)) continue;
      if (id === trailId) continue;
      // Don't erase eraser trails
      if (shape.toolUrl && shape.toolUrl.includes('eraser/tool.js')) continue;

      // Check if the eraser circle overlaps this shape
      const sx = shape.x || 0;
      const sy = shape.y || 0;

      // For shapes with points (lines, sparkle markers), check point proximity
      if (shape.points && shape.points.length > 0) {
        for (const pt of shape.points) {
          const ptx = sx + (pt[0] || 0);
          const pty = sy + (pt[1] || 0);
          const dist = Math.sqrt((px - ptx) ** 2 + (py - pty) ** 2);
          if (dist < ERASER_RADIUS + 8) {
            toDelete.push(id);
            break;
          }
        }
      }
      // For shapes with width/height (rectangles, embeds)
      else if (shape.width && shape.height) {
        const inX = px >= sx - ERASER_RADIUS && px <= sx + shape.width + ERASER_RADIUS;
        const inY = py >= sy - ERASER_RADIUS && py <= sy + shape.height + ERASER_RADIUS;
        if (inX && inY) {
          toDelete.push(id);
        }
      }
      // For text shapes, rough bounding box
      else if (shape.text !== undefined) {
        const tw = Math.max(50, (shape.text || '').length * 8);
        const th = 24;
        const inX = px >= sx - ERASER_RADIUS && px <= sx + tw + ERASER_RADIUS;
        const inY = py >= sy - ERASER_RADIUS && py <= sy + th + ERASER_RADIUS;
        if (inX && inY) {
          toDelete.push(id);
        }
      }
    }

    if (toDelete.length > 0) {
      canvas.ref.at('shapes').change((shapes) => {
        for (const id of toDelete) {
          delete shapes[id];
          erasedIds.add(id);
        }
      });
    }
  }

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;

    dragging = true;
    erasedIds = new Set();
    const pos = getCanvasPos(event);
    trailPoints = [[pos.x, pos.y]];
    trailId = `eraser_trail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    canvas.ref.at('shapes', trailId).change(() => ({
      x: 0,
      y: 0,
      toolUrl: eraserToolUrl,
      points: [[pos.x, pos.y]],
      createdAt: Date.now(),
    }));

    canvas.setPointerCapture(event.pointerId);
    eraseAtPoint(pos.x, pos.y);
  }

  function onPointerMove(event) {
    if (!dragging || !trailId) return;
    const pos = getCanvasPos(event);
    trailPoints.push([pos.x, pos.y]);

    canvas.ref.at('shapes', trailId).change((shape) => {
      shape.points.push([pos.x, pos.y]);
    });

    eraseAtPoint(pos.x, pos.y);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;

    // Remove trail immediately
    const id = trailId;
    if (id) {
      try {
        canvas.ref.at('shapes').change((shapes) => {
          delete shapes[id];
        });
      } catch(e) {}
    }

    trailId = null;
    trailPoints = [];
    erasedIds = new Set();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  // Custom cursor when eraser is active
  function updateCursor() {
    if (active()) {
      canvas.style.cursor = 'none';
    }
  }

  // Show a visual cursor circle
  let cursorEl = null;

  function createCursor() {
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
  createCursor();

  function onGlobalMove(e) {
    if (!cursorEl) return;
    if (active()) {
      cursorEl.style.display = 'block';
      cursorEl.style.left = e.clientX + 'px';
      cursorEl.style.top = e.clientY + 'px';
      canvas.style.cursor = 'none';
    } else {
      cursorEl.style.display = 'none';
      canvas.style.cursor = '';
    }
  }
  document.addEventListener('pointermove', onGlobalMove);

  const dispose = render(
    () =>
      html`<button
        onPointerDown=${(e) => e.stopPropagation()}
        onClick=${toggleTool}
        style=${() => ({
          width: '32px',
          height: '32px',
          border: active() ? '2px solid #94a3b8' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: active() ? '#f1f5f9' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
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
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointermove', onGlobalMove);
    if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
    canvas.style.cursor = '';
    dispose();
  };
}
