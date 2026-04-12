import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';
import { getViewUrl } from '../url.js';
import { selectedToolSchema, shapesSchema } from '../paper/schema.js';

const TOOL_NAME = 'text';
const textViewUrl = getViewUrl('./tool.json', import.meta.url);

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
  const shapesRef = canvas.getOrCreate(shapesSchema);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const page = canvas.screenToPage(event.clientX, event.clientY);
    const x = page.x;
    const halfLineHeight = Math.round((18 * 1.4) / 2);
    const y = page.y - halfLineHeight;
    const id = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    shapesRef.at(id).change(() => ({
      x,
      y,
      viewUrl: textViewUrl,
      text: '',
    }));
    selectedToolRef.change(() => '');
    const shapeUrl = shapesRef.at(id).url;
    canvas.addEventListener(
      'mounted',
      (event) => {
        const refView = event.target.closest('ref-view');
        if (refView?.getAttribute('ref-url') !== shapeUrl) return;
        const textarea = refView.querySelector('textarea');
        textarea?.focus();
      },
      { once: true },
    );
  }

  canvas.addEventListener('pointerdown', onPointerDown);

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
          <path d="M4 3h8M8 3v10" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    dispose();
  };
}
