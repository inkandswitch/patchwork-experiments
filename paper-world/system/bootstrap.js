import { createExamples } from './examples.js';
import { getViewUrl } from './url.js';

const MAX_PREVIEW_W = 280;
const MAX_PREVIEW_H = 200;
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 200;

function starterKey(example) {
  return example.source + '#' + example.name;
}

export default function mount(element) {
  const fs = element.filesystem;
  const registry = createExamples(fs);

  let starters = [];
  let selectedKey = null;
  const cardCache = new Map();
  const examplesByKey = new Map();

  const root = document.createElement('div');
  root.style.cssText = `
    width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: #f8fafc;
    box-sizing: border-box;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    max-width: 720px; width: 100%;
    display: flex; flex-direction: column; align-items: center; gap: 24px;
    padding: 40px 24px;
  `;

  const title = document.createElement('h1');
  title.textContent = 'Paper World';
  title.style.cssText = 'margin: 0; font-size: 28px; font-weight: 700; color: #0f172a;';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Choose a template to get started';
  subtitle.style.cssText = 'margin: 0; font-size: 14px; color: #64748b;';
  container.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px; width: 100%;
  `;
  container.appendChild(grid);

  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.disabled = true;
  createBtn.style.cssText = `
    padding: 10px 32px; font-size: 15px; font-weight: 600;
    border: none; border-radius: 8px; cursor: pointer;
    background: #d1d5db; color: #fff;
    transition: background 0.15s ease, transform 0.1s ease;
  `;
  createBtn.addEventListener('click', () => {
    const example = selectedKey ? examplesByKey.get(selectedKey) : null;
    if (!example) return;

    const toolViewUrl = getViewUrl('./' + example.tool, import.meta.url);

    element.ref.change((doc) => {
      const value = structuredClone(example.value);
      for (const key of Object.keys(value)) {
        doc[key] = value[key];
      }
    });

    element.dispatchEvent(
      new CustomEvent('patchwork:set-tool-url', {
        bubbles: true,
        detail: { toolUrl: toolViewUrl },
      }),
    );
  });
  container.appendChild(createBtn);

  root.appendChild(container);
  element.appendChild(root);

  const previewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const previewContainer = entry.target;
      if (previewContainer.querySelector('ref-view')) continue;
      const key = previewContainer.dataset.starterKey;
      const example = examplesByKey.get(key);
      if (!example) continue;
      const repo = globalThis.repo;
      if (!repo) continue;
      const nativeWidth = example.width || DEFAULT_WIDTH;
      const nativeHeight = example.height || DEFAULT_HEIGHT;
      const scale = Math.min(1, MAX_PREVIEW_W / nativeWidth, MAX_PREVIEW_H / nativeHeight);
      const handle = repo.create(structuredClone(example.value));
      const inner = document.createElement('ref-view');
      inner.style.cssText = `display:block;width:${nativeWidth}px;height:${nativeHeight}px;transform:scale(${scale});transform-origin:top left;pointer-events:none;`;
      inner.setAttribute('ref-url', handle.url);
      inner.setAttribute('view-url', example.tool);
      previewContainer.appendChild(inner);
    }
  }, { rootMargin: '100px' });

  function renderGrid() {
    examplesByKey.clear();
    for (const ex of starters) examplesByKey.set(starterKey(ex), ex);

    if (starters.length === 0) {
      for (const [, entry] of cardCache) {
        previewObserver.unobserve(entry.previewContainer);
      }
      cardCache.clear();
      grid.innerHTML = '';
      const empty = document.createElement('div');
      empty.textContent = 'No templates found';
      empty.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #9ca3af; padding: 40px;';
      grid.appendChild(empty);
      return;
    }

    const activeKeys = new Set(starters.map(starterKey));
    for (const [key, entry] of cardCache) {
      if (!activeKeys.has(key)) {
        previewObserver.unobserve(entry.previewContainer);
        cardCache.delete(key);
      }
    }

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    for (const example of starters) {
      const key = starterKey(example);
      let entry = cardCache.get(key);
      if (!entry) {
        entry = makeCard(example);
        cardCache.set(key, entry);
        previewObserver.observe(entry.previewContainer);
      }
      grid.appendChild(entry.card);
    }

    if (!selectedKey && starters.length > 0) {
      selectedKey = starterKey(starters[0]);
    }
    updateSelection();
  }

  function updateSelection() {
    for (const [key, entry] of cardCache) {
      if (key === selectedKey) {
        entry.card.style.borderColor = '#3b82f6';
        entry.card.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.3)';
      } else {
        entry.card.style.borderColor = '#e2e8f0';
        entry.card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
      }
    }

    if (selectedKey && examplesByKey.has(selectedKey)) {
      createBtn.disabled = false;
      createBtn.style.background = '#3b82f6';
      createBtn.style.cursor = 'pointer';
    } else {
      createBtn.disabled = true;
      createBtn.style.background = '#d1d5db';
      createBtn.style.cursor = 'default';
    }
  }

  function makeCard(example) {
    const key = starterKey(example);
    const card = document.createElement('div');
    card.setAttribute('data-starter-card', '');
    card.style.cssText = `
      border: 2px solid #e2e8f0; border-radius: 12px;
      overflow: hidden; cursor: pointer;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    `;

    card.addEventListener('click', () => {
      selectedKey = key;
      updateSelection();
    });

    const nativeWidth = example.width || DEFAULT_WIDTH;
    const nativeHeight = example.height || DEFAULT_HEIGHT;
    const scale = Math.min(1, MAX_PREVIEW_W / nativeWidth, MAX_PREVIEW_H / nativeHeight);

    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
      width: 100%; height: ${nativeHeight * scale}px;
      overflow: hidden; position: relative; background: #f1f5f9;
      display: flex; align-items: center; justify-content: center;
    `;
    previewContainer.dataset.starterKey = key;
    previewContainer.addEventListener('pointerdown', (e) => e.stopPropagation());
    card.appendChild(previewContainer);

    const label = document.createElement('div');
    label.style.cssText = 'padding: 10px 12px;';

    const nameEl = document.createElement('div');
    nameEl.textContent = example.name;
    nameEl.style.cssText = 'font-weight: 600; font-size: 13px; color: #1e293b;';
    label.appendChild(nameEl);

    if (example.description) {
      const desc = document.createElement('div');
      desc.textContent = example.description;
      desc.style.cssText = 'font-size: 11px; color: #64748b; margin-top: 2px; line-height: 1.3;';
      label.appendChild(desc);
    }

    card.appendChild(label);
    return { card, previewContainer };
  }

  const unsub = registry.all().subscribe((list) => {
    starters = list.filter((ex) => ex.tags && ex.tags.includes('starter'));
    renderGrid();
  });

  return () => {
    previewObserver.disconnect();
    if (typeof unsub === 'function') unsub();
    root.remove();
  };
}
