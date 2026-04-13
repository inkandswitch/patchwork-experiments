import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { findTargetSurface, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const TOOL_NAME = 'text';
const textViewUrl = getViewUrl('./tool.json', import.meta.url);

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

  function onPointerDown(event) {
    if (!active()) return;
    const targetSurface = findTargetSurface(event.target, surface);
    if (!targetSurface) return;
    const drawShapesRef = targetSurface.getOrCreate(surfaceSchema);
    const page = targetSurface.screenToPage(event.clientX, event.clientY);
    const x = page.x;
    const halfLineHeight = Math.round((18 * 1.4) / 2);
    const y = page.y - halfLineHeight;
    const id = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    drawShapesRef.at(id).change(() => ({
      viewUrl: textViewUrl,
      data: { x, y, text: '' },
    }));
    selectedToolRef.change(() => '');
    const shapeUrl = drawShapesRef.at(id).at('data').url;
    targetSurface.addEventListener(
      'mounted',
      (event) => {
        const refView = event.target.closest('ref-view');
        if (refView?.getAttribute('ref-url') !== shapeUrl) return;
        const cmContent = refView.querySelector('.cm-content');
        cmContent?.focus();
      },
      { once: true },
    );
  }

  if (surface) {
    surface.addEventListener('pointerdown', onPointerDown);
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
          <path d="M4 3h8M8 3v10" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    if (surface) {
      surface.removeEventListener('pointerdown', onPointerDown);
    }
    dispose();
  };
}
