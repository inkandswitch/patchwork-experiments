import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';

const TOOL_NAME = 'text';
const textToolUrl = new URL('./shape.js', import.meta.url).href;

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./button.js', import.meta.url).href };
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

export default function mount(element) {
  const canvas = element.parent;
  const selectedToolRef = canvas.ref.at('selectedTool').as(selectedToolSchema);
  const selectedTool = from(selectedToolRef);

  const active = () => selectedTool() === TOOL_NAME;

  function toggleTool() {
    const next = active() ? '' : TOOL_NAME;
    selectedToolRef.change(() => next);
  }

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const halfLineHeight = Math.round((18 * 1.4) / 2);
    const y = event.clientY - rect.top - halfLineHeight;
    const id = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    canvas.ref.at('shapes', id).change(() => ({
      x,
      y,
      toolUrl: textToolUrl,
      text: '',
    }));
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
