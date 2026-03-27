import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getToolUrl } from '../url.js';

const TOOL_NAME = 'selection';

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 40, y: 10, toolUrl: getToolUrl('./button.js', import.meta.url) };
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

const selectedShapesSchema = {
  init() {
    return {};
  },
  parse(value) {
    return typeof value === 'object' && value ? value : {};
  },
};

export default function mount(element) {
  const canvas = element.parent;
  const selectedToolRef = canvas.ref.at('selectedTool').as(selectedToolSchema);
  const selectedTool = from(selectedToolRef);
  const selectedShapesRef = canvas.ref.at('selectedShapes').as(selectedShapesSchema);

  function isSelectionToolActive() {
    return selectedTool() === TOOL_NAME;
  }

  function toggleTool() {
    if (isSelectionToolActive()) {
      selectedShapesRef.change(() => ({}));
    }
    selectedToolRef.change(() => (isSelectionToolActive() ? '' : TOOL_NAME));
  }

  let dragShapeId = null;
  let startPointerX = 0;
  let startPointerY = 0;
  let startShapeX = 0;
  let startShapeY = 0;

  function onPointerDown(event) {
    if (!isSelectionToolActive()) return;

    let shapeId = shapeIdFromEvent(event, canvas);
    if (!shapeId) {
      shapeId = probeNearbyShapes(event, canvas);
    }
    if (!shapeId) {
      shapeId = findNearbyLine(event, canvas);
    }
    if (!shapeId) {
      selectedShapesRef.change(() => ({}));
      return;
    }

    const shape = canvas.ref.at('shapes', shapeId).value();
    if (shape.isLocked) return;

    selectedShapesRef.change(() => ({ [shapeId]: true }));

    dragShapeId = shapeId;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startShapeX = shape.x;
    startShapeY = shape.y;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragShapeId) return;
    const deltaX = event.clientX - startPointerX;
    const deltaY = event.clientY - startPointerY;
    canvas.ref.at('shapes', dragShapeId).change((shape) => {
      shape.x = startShapeX + deltaX;
      shape.y = startShapeY + deltaY;
    });
  }

  function onPointerUp() {
    dragShapeId = null;
  }

  function onKeyDown(event) {
    if (!isSelectionToolActive()) return;
    if (isFocusedTextEditingTarget()) return;

    if (event.metaKey && event.key === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const selected = selectedShapesRef.value();
    const ids = Object.keys(selected).filter((shapeId) => {
      const shapeEntry = canvas.ref.at('shapes', shapeId).value();
      return !shapeEntry.isLocked;
    });
    if (!ids.length) return;
    event.preventDefault();
    canvas.ref.at('shapes').change((shapes) => {
      for (const id of ids) {
        delete shapes[id];
      }
    });
    selectedShapesRef.change(() => ({}));
  }

  function duplicateSelection() {
    const selected = selectedShapesRef.value();
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length) return;

    const newSelection = {};
    for (const id of ids) {
      const shape = canvas.ref.at('shapes', id).value();
      if (!shape || shape.isLocked) continue;
      const newId = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const clone = structuredClone(shape);
      if (typeof clone.width === 'number' && typeof clone.height === 'number') {
        clone.x += clone.width;
      } else {
        clone.x += 10;
        clone.y += 10;
      }
      canvas.ref.at('shapes', newId).change(() => clone);
      newSelection[newId] = true;
    }
    selectedShapesRef.change(() => newSelection);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  document.addEventListener('keydown', onKeyDown);

  const dispose = render(
    () =>
      html`<button
        onPointerDown=${(e) => e.stopPropagation()}
        onClick=${toggleTool}
        style=${() => ({
          width: '32px',
          height: '32px',
          border: isSelectionToolActive() ? '2px solid #3b82f6' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: isSelectionToolActive() ? '#eff6ff' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 2l8 6-4 1-2 4-2-11z" stroke=${() => (isSelectionToolActive() ? '#3b82f6' : '#71717a')} stroke-width="1.5" fill="none" stroke-linejoin="round" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('keydown', onKeyDown);
    dispose();
  };
}

function shapeIdFromEvent(event, canvas) {
  const childRefView = event.target.closest('ref-view');
  if (!childRefView || childRefView === canvas) return null;
  const refUrl = childRefView.getAttribute('ref-url');
  if (!refUrl) return null;
  const parts = refUrl.split('/');
  return parts[parts.length - 1];
}

const PROBE_OFFSETS = [
  [6, 0], [-6, 0], [0, 6], [0, -6],
  [6, 6], [-6, -6], [6, -6], [-6, 6],
  [10, 0], [-10, 0], [0, 10], [0, -10],
];

function probeNearbyShapes(event, canvas) {
  for (const [dx, dy] of PROBE_OFFSETS) {
    const el = document.elementFromPoint(event.clientX + dx, event.clientY + dy);
    if (!el) continue;
    const refView = el.closest('ref-view');
    if (!refView || refView === canvas) continue;
    const refUrl = refView.getAttribute('ref-url');
    if (!refUrl) continue;
    const parts = refUrl.split('/');
    return parts[parts.length - 1];
  }
  return null;
}

function findNearbyLine(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const shapes = canvas.ref.at('shapes').value();
  const threshold = 10;

  let closestId = null;
  let closestDist = threshold;

  for (const [id, shape] of Object.entries(shapes)) {
    if (!shape.points || shape.points.length < 2) continue;
    if (shape.isLocked) continue;

    for (let i = 0; i < shape.points.length - 1; i++) {
      const segStartX = shape.x + shape.points[i][0];
      const segStartY = shape.y + shape.points[i][1];
      const segEndX = shape.x + shape.points[i + 1][0];
      const segEndY = shape.y + shape.points[i + 1][1];
      const dist = distanceToSegment(cursorX, cursorY, segStartX, segStartY, segEndX, segEndY);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
  }

  return closestId;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function isFocusedTextEditingTarget() {
  const activeElement = document.activeElement;
  if (!activeElement || !(activeElement instanceof HTMLElement)) return false;
  if (activeElement.isContentEditable) return true;
  if (
    activeElement.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]',
    )
  ) {
    return true;
  }
  if (activeElement instanceof HTMLTextAreaElement) {
    return !activeElement.readOnly && !activeElement.disabled;
  }
  if (activeElement instanceof HTMLInputElement) {
    if (activeElement.readOnly || activeElement.disabled) return false;
    const textEditingTypes = new Set([
      '',
      'text',
      'search',
      'url',
      'tel',
      'email',
      'password',
      'number',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
    ]);
    return textEditingTypes.has(activeElement.type);
  }
  return false;
}
