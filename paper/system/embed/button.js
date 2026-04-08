import { z } from 'https://esm.sh/zod@4.3';
import { from, createSignal, render, html } from '../solid.js';
import { getViewUrl, toViewPath } from '../url.js';
import { selectedToolSchema, shapesSchema } from '../paper/schema.js';
import styles from './button.css' with { type: 'css' };

document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

const TOOL_NAME = 'embed';
const embedViewUrl = getViewUrl('./tool.json', import.meta.url);

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

const schemaCache = new Map();

async function loadSchema(url) {
  if (schemaCache.has(url)) return schemaCache.get(url);
  const mod = await import(url);
  schemaCache.set(url, mod.default);
  return mod.default;
}

export default function mount(element) {
  const canvas = element.findParent(shapesSchema);
  if (!canvas) return;
  const selectedToolRef = canvas.getOrCreate(selectedToolSchema);
  const selectedTool = from(selectedToolRef);
  const shapesRef = canvas.getOrCreate(shapesSchema);

  const schemaPlugins = from(element.plugins.byType('schema'));
  const toolPlugins = from(element.plugins.byType('tool'));

  function embedTypes() {
    return (schemaPlugins() ?? []).filter((p) => !p.unlisted);
  }

  const active = () => selectedTool() === TOOL_NAME;

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [selectedPlugin, setSelectedPlugin] = createSignal(null);

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

  function selectType(plugin) {
    setSelectedPlugin(plugin);
    setMenuOpen(false);
    selectedToolRef.change(() => TOOL_NAME);
  }

  async function onPointerDown(event) {
    if (!active()) return;
    if (event.target.closest('ref-view') !== canvas) return;

    const repo = globalThis.repo;
    if (!repo?.create) {
      console.error('embed: globalThis.repo.create is required to place an embed');
      return;
    }

    const plugin = selectedPlugin();
    if (!plugin) return;

    const pluginSchema = await loadSchema(plugin.source);
    const initData = pluginSchema.init();
    const embedHandle = repo.create(initData);
    const embedDocUrl = embedHandle.url;

    const matchedViewUrl = await findMatchingView(initData);

    const page = canvas.screenToPage(event.clientX, event.clientY);
    startX = page.x;
    startY = page.y;
    dragId = `embed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    shapesRef.at(dragId).change(() => ({
      x: startX,
      y: startY,
      viewUrl: embedViewUrl,
      embedViewUrl: matchedViewUrl,
      embedDocUrl,
      width: 0,
      height: 0,
    }));
    canvas.setPointerCapture(event.pointerId);
  }

  async function findMatchingView(value) {
    const tools = (toolPlugins() ?? []).filter((p) => p.schemaUrl);
    const matches = [];
    for (const tool of tools) {
      try {
        const toolSchema = await loadSchema(tool.schemaUrl);
        toolSchema.parse(value);
        const initKeys = Object.keys(toolSchema.init?.() ?? {});
        matches.push({ tool, fieldCount: initKeys.length });
      } catch {
        // schema incompatible
      }
    }
    matches.sort((a, b) => b.fieldCount - a.fieldCount);
    return matches[0]?.tool.source ? toViewPath(matches[0].tool.source) : '';
  }

  function onPointerMove(event) {
    if (!dragId) return;
    const { x: currentX, y: currentY } = canvas.screenToPage(event.clientX, event.clientY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    shapesRef.at(dragId).change((shape) => {
      shape.x = x;
      shape.y = y;
      shape.width = width;
      shape.height = height;
    });
  }

  function onPointerUp() {
    if (dragId) {
      const shape = shapesRef.at(dragId).value();
      if (shape.width < 4 && shape.height < 4) {
        shapesRef.at(dragId).change((s) => {
          s.x = startX - 160;
          s.y = startY - 120;
          s.width = 320;
          s.height = 240;
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
                ${embedTypes().map(
              (plugin) =>
                html`<button
                      onClick=${() => selectType(plugin)}
                      class="embed-menu-item"
                    >
                      ${plugin.name}
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
