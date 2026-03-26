import { z } from 'https://esm.sh/zod@4.3';
import { from, createSignal, render, html } from '../solid.js';
import { getToolUrl } from '../url.js';
import styles from './button.css' with { type: 'css' };

document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

const TOOL_NAME = 'embed';
const embedToolUrl = getToolUrl('./shape.js', import.meta.url);

const EMBED_TYPES = [
  {
    id: 'llm',
    label: 'LLM Chat',
    toolUrl: getToolUrl('../llm/shape.js', import.meta.url),
    defaultWidth: 320,
    defaultHeight: 400,
    createDoc(repo) {
      return repo.create({
        config: { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
        runs: [],
      });
    },
  },

];

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

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [selectedType, setSelectedType] = createSignal(EMBED_TYPES[0]);

  let dragId = null;
  let startX = 0;
  let startY = 0;

  function toggleMenu() {
    if (active()) {
      selectedToolRef.change(() => '');
      setMenuOpen(false);
    } else {
      setMenuOpen(!menuOpen());
    }
  }

  function selectType(embedType) {
    setSelectedType(embedType);
    setMenuOpen(false);
    selectedToolRef.change(() => TOOL_NAME);
  }

  function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;

    const repo = globalThis.repo;
    if (!repo?.create) {
      console.error('embed: globalThis.repo.create is required to place an embed');
      return;
    }

    const embedType = selectedType();
    const embedHandle = embedType.createDoc(repo);
    const embedDocUrl = embedHandle.url;

    const rect = canvas.getBoundingClientRect();
    startX = event.clientX - rect.left;
    startY = event.clientY - rect.top;
    dragId = `embed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    canvas.ref.at('shapes', dragId).change(() => ({
      x: startX,
      y: startY,
      toolUrl: embedToolUrl,
      embedToolUrl: embedType.toolUrl,
      embedDocUrl,
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
        const embedType = selectedType();
        canvas.ref.at('shapes', dragId).change((s) => {
          s.x = startX - embedType.defaultWidth / 2;
          s.y = startY - embedType.defaultHeight / 2;
          s.width = embedType.defaultWidth;
          s.height = embedType.defaultHeight;
        });
      }
      selectedToolRef.change(() => '');
    }
    dragId = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  const dispose = render(
    () =>
      html`<div
        class="embed-btn-wrap"
        onPointerDown=${(e) => e.stopPropagation()}
      >
        <button
          onClick=${toggleMenu}
          class=${() => `embed-btn${active() ? ' active' : ''}`}
          title="Embed"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="6" height="6" rx="1" stroke-width="1.2" fill="none" />
            <rect x="9" y="1" width="6" height="6" rx="1" stroke-width="1.2" fill="none" />
            <rect x="1" y="9" width="6" height="6" rx="1" stroke-width="1.2" fill="none" />
            <rect x="9" y="9" width="6" height="6" rx="1" stroke-width="1.2" fill="none" />
          </svg>
        </button>
        ${() =>
          menuOpen()
            ? html`<div class="embed-menu">
                ${EMBED_TYPES.map(
              (embedType) =>
                html`<button
                      onClick=${() => selectType(embedType)}
                      class="embed-menu-item"
                    >
                      ${embedType.label}
                    </button>`,
            )}
              </div>`
            : ''}
      </div>`,
    element,
  );

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    dispose();
  };
}
