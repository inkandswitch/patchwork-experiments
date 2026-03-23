import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html } from '../solid.js';

const TOOL_NAME = 'embed';
const embedToolUrl = new URL('./shape.js', import.meta.url).href;

const EMBED_TYPES = [
  { id: 'rectangle', name: 'Rectangle', toolUrl: new URL('../rectangle/shape.js', import.meta.url).href },
];

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

  let pendingToolUrl = null;
  let closeMenuFn = null;
  let dragId = null;
  let startX = 0;
  let startY = 0;

  function toggleTool() {
    if (active()) {
      closeMenu();
      selectedToolRef.change(() => '');
      pendingToolUrl = null;
    } else {
      selectedToolRef.change(() => TOOL_NAME);
      openMenu();
    }
  }

  function openMenu() {
    closeMenu();
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'background:#fff',
      'border:1px solid #ddd',
      'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.15)',
      'padding:4px',
      'min-width:160px',
      'font:13px/1.4 system-ui,sans-serif',
    ].join(';');

    for (const embedType of EMBED_TYPES) {
      const row = document.createElement('button');
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'width:100%',
        'padding:6px 10px',
        'border:none',
        'background:none',
        'border-radius:5px',
        'cursor:pointer',
        'text-align:left',
        'font:inherit',
        'box-sizing:border-box',
      ].join(';');
      row.textContent = embedType.name;
      row.addEventListener('mouseover', () => {
        row.style.background = '#f0f0f0';
      });
      row.addEventListener('mouseout', () => {
        row.style.background = '';
      });
      row.addEventListener('pointerdown', (e) => e.stopPropagation());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingToolUrl = embedType.toolUrl;
        closeMenu();
      });
      menu.appendChild(row);
    }

    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    const btnRect = element.getBoundingClientRect();
    const menuH = menu.offsetHeight;
    const menuW = menu.offsetWidth;
    menu.style.left = `${Math.min(btnRect.left, window.innerWidth - menuW - 8)}px`;
    menu.style.top = `${btnRect.top - menuH - 4}px`;
    menu.style.visibility = '';

    function onOutside(e) {
      if (!menu.contains(e.target)) closeMenu();
    }
    setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);

    closeMenuFn = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onOutside);
      closeMenuFn = null;
    };
  }

  function closeMenu() {
    if (closeMenuFn) closeMenuFn();
  }

  function onPointerDown(event) {
    if (!active() || !pendingToolUrl) return;
    if (event.target.closest('ref-view') !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    dragId = `embed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    canvas.ref.at('shapes', dragId).change(() => ({
      x: startX,
      y: startY,
      toolUrl: embedToolUrl,
      embedToolUrl: pendingToolUrl,
      width: 0,
      height: 0,
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    canvas.ref.at('shapes', dragId).change((shape) => {
      shape.x = x;
      shape.y = y;
      shape.width = width;
      shape.height = height;
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = canvas.ref.at('shapes', dragId).value();
      if (shape.width < 4 && shape.height < 4) {
        const defaultWidth = 200;
        const defaultHeight = 150;
        canvas.ref.at('shapes', dragId).change((s) => {
          s.x = startX - defaultWidth / 2;
          s.y = startY - defaultHeight / 2;
          s.width = defaultWidth;
          s.height = defaultHeight;
        });
      }
    }
    dragId = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

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
          <rect x="1" y="1" width="6" height="6" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.2" fill="none" />
          <rect x="9" y="1" width="6" height="6" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.2" fill="none" />
          <rect x="1" y="9" width="6" height="6" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.2" fill="none" />
          <rect x="9" y="9" width="6" height="6" rx="1" stroke=${() => (active() ? '#3b82f6' : '#71717a')} stroke-width="1.2" fill="none" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    closeMenu();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    dispose();
  };
}
