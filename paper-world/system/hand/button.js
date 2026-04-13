import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const TOOL_NAME = 'hand';

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
  const surface = element.findParent(surfaceSchema);
  if (!surface) return;
  const selectedToolRef = surface.getOrCreate(selectedToolSchema);
  const selectedTool = from(selectedToolRef);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    console.log('[hand] toggleTool called, active:', active(), 'current selectedTool:', selectedTool());
    const next = active() ? '' : TOOL_NAME;
    console.log('[hand] setting selectedTool to:', JSON.stringify(next));
    selectedToolRef.change(() => next);
    console.log('[hand] after change, selectedTool:', selectedTool());
    if (!next) surface.style.cursor = '';
  }

  let panSurface = null;
  let startPointerX = 0;
  let startPointerY = 0;
  let startCam = null;

  function onPointerDown(event) {
    console.log('[hand] surface pointerdown, active:', active(), 'target:', event.target.tagName);
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    panSurface = targetSurface;
    startCam = panSurface.getCamera();
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    surface.setPointerCapture(event.pointerId);
    surface.style.cursor = 'grabbing';
  }

  function onPointerMove(event) {
    if (!panSurface) return;
    const dx = event.clientX - startPointerX;
    const dy = event.clientY - startPointerY;
    panSurface.setCamera({
      x: startCam.x + dx / startCam.zoom,
      y: startCam.y + dy / startCam.zoom,
      zoom: startCam.zoom,
    });
  }

  function onPointerUp(event) {
    console.log('[hand] surface pointerup, panSurface:', !!panSurface);
    if (!panSurface) return;
    panSurface = null;
    startCam = null;
    surface.releasePointerCapture(event.pointerId);
    surface.style.cursor = active() ? 'grab' : '';
  }

  function updateCursor() {
    if (!panSurface) {
      surface.style.cursor = active() ? 'grab' : '';
    }
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);

  const dispose = render(
    () => {
      updateCursor();
      return html`<button
        onPointerDown=${(e) => { console.log('[hand] button pointerdown, stopping propagation'); e.stopPropagation(); }}
        onClick=${(e) => { console.log('[hand] button click fired'); toggleTool(); }}
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
          <path
            d="M8 1.5v4M5.5 3v6.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6.5M5.5 6.5 4 5a1 1 0 0 0-1.5 0v0A1 1 0 0 0 2 6v3.5a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V6M8 5.5h2.5a1 1 0 0 1 1 1V6M8 5.5V3a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3.5"
            stroke=${() => (active() ? '#3b82f6' : '#71717a')}
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>`;
    },
    element,
  );

  return () => {
    surface.style.cursor = '';
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerUp);
    dispose();
  };
}
