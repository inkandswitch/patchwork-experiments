import { createExamples } from '../examples.js';
import { getToolUrl } from '../url.js';
import { schema } from './schema.js';

export { schema };

const MAX_PREVIEW_W = 260;
const MAX_PREVIEW_H = 300;
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 200;

export default function mount(element) {
  const fs = element.filesystem;
  const registry = createExamples(fs);

  let allExamples = [];
  let searchTerm = '';

  const shapeData = element.ref.as(schema).value();
  const galleryWidth = shapeData.width || 280;
  const galleryHeight = shapeData.height || 800;

  const root = document.createElement('div');
  root.style.cssText = `width:${galleryWidth}px;height:${galleryHeight}px;max-height:800px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(0,0,0,0.08);display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;box-sizing:border-box;`;

  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;display:flex;align-items:center;gap:10px;flex-shrink:0;';
  header.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span style="font-weight:600;font-size:14px">Parts Bin</span>';
  root.appendChild(header);

  const searchBar = document.createElement('div');
  searchBar.style.cssText = 'padding:8px;flex-shrink:0;border-bottom:1px solid #e2e8f0;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search examples\u2026';
  searchInput.style.cssText = 'width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;';
  searchInput.addEventListener('focus', () => { searchInput.style.borderColor = '#10b981'; });
  searchInput.addEventListener('blur', () => { searchInput.style.borderColor = '#d1d5db'; });
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.toLowerCase();
    renderFiltered();
  });
  searchBar.appendChild(searchInput);
  root.appendChild(searchBar);

  const listArea = document.createElement('div');
  listArea.style.cssText = 'flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:12px;';
  root.appendChild(listArea);

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:8px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#9ca3af;flex-shrink:0;';
  footer.textContent = '0 examples';
  root.appendChild(footer);

  element.appendChild(root);

  function filterExamples(examples) {
    if (!searchTerm) return examples;
    return examples.filter((ex) => {
      const hay = (ex.name + ' ' + ex.description + ' ' + ex.package).toLowerCase();
      return hay.includes(searchTerm);
    });
  }

  function groupByPackage(examples) {
    const groups = [];
    const map = new Map();
    for (const ex of examples) {
      const key = ex.package || 'Other';
      if (!map.has(key)) {
        const group = { package: key, examples: [] };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key).examples.push(ex);
    }
    return groups;
  }

  function renderFiltered() {
    const filtered = filterExamples(allExamples);
    listArea.innerHTML = '';

    if (filtered.length === 0) {
      listArea.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af">No examples found</div>';
      footer.textContent = '0 examples';
      return;
    }

    const groups = groupByPackage(filtered);
    for (const group of groups) {
      const groupHeader = document.createElement('div');
      groupHeader.textContent = group.package;
      groupHeader.style.cssText = 'font-weight:700;font-size:13px;color:#0f172a;padding:6px 8px 4px;margin:0 -8px;position:sticky;top:-8px;background:#fff;z-index:1;';
      listArea.appendChild(groupHeader);

      for (const example of group.examples) {
        const card = makeCard(example);
        listArea.appendChild(card);
      }
    }

    footer.textContent = filtered.length + ' example' + (filtered.length === 1 ? '' : 's');
  }

  function placeExample(example) {
    const canvas = element.parent;
    if (!canvas?.ref) return;

    const currentData = element.ref.as(schema).value();

    let createValue = example.value;
    let createTool = example.tool;
    if (example.create) {
      const extracted = getAtDotPath(example.value, example.create);
      if (extracted && typeof extracted === 'object') {
        createValue = extracted;
        if (typeof extracted.toolUrl === 'string') {
          createTool = extracted.toolUrl;
        }
      }
    }

    const toolPath = getToolUrl('../' + createTool, import.meta.url);
    const newWidth = createValue.width || example.width || DEFAULT_WIDTH;
    const newHeight = createValue.height || example.height || DEFAULT_HEIGHT;

    const shapeId = `example_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    canvas.ref.at('shapes', shapeId).change(() => ({
      ...structuredClone(createValue),
      x: (currentData.x || 0) + (currentData.width || 280) + 20,
      y: currentData.y || 0,
      toolUrl: toolPath,
      width: newWidth,
      height: newHeight,
    }));
  }

  function makeCard(example) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;flex-shrink:0;';

    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = 'padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1;min-width:0;';
    const title = document.createElement('div');
    title.textContent = example.name;
    title.style.cssText = 'font-weight:600;color:#1e293b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    nameEl.appendChild(title);

    if (example.description) {
      const desc = document.createElement('div');
      desc.textContent = example.description;
      desc.style.cssText = 'font-size:11px;color:#64748b;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameEl.appendChild(desc);
    }
    cardHeader.appendChild(nameEl);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'background:#f1f5f9;border:1px solid #d1d5db;border-radius:4px;padding:2px 8px;font-size:11px;color:#64748b;cursor:pointer;';
    btnGroup.appendChild(resetBtn);

    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.style.cssText = 'background:#10b981;border:1px solid #059669;border-radius:4px;padding:2px 8px;font-size:11px;color:#fff;cursor:pointer;';
    createBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      placeExample(example);
    });
    btnGroup.appendChild(createBtn);

    cardHeader.appendChild(btnGroup);
    card.appendChild(cardHeader);

    const nativeWidth = example.width || DEFAULT_WIDTH;
    const nativeHeight = example.height || DEFAULT_HEIGHT;
    const scale = Math.min(1, MAX_PREVIEW_W / nativeWidth, MAX_PREVIEW_H / nativeHeight);

    const outer = document.createElement('div');
    outer.style.cssText = `width:${nativeWidth * scale}px;height:${nativeHeight * scale}px;overflow:hidden;position:relative;`;
    outer.addEventListener('pointerdown', (e) => e.stopPropagation());

    const repo = globalThis.repo;
    const resolved = resolveToolUrls(structuredClone(example.value), fs);
    const handle = repo.create(resolved);
    const toolUrl = fs.getUrlOfFile(example.tool);

    const inner = document.createElement('ref-view');
    inner.style.cssText = `display:block;width:${nativeWidth}px;height:${nativeHeight}px;transform:scale(${scale});transform-origin:top left;`;
    inner.setAttribute('ref-url', handle.url);
    inner.setAttribute('tool-url', toolUrl);
    outer.appendChild(inner);
    card.appendChild(outer);

    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const fresh = repo.create(resolveToolUrls(structuredClone(example.value), fs));
      inner.setAttribute('ref-url', fresh.url);
    });

    return card;
  }

  registry.all().subscribe((list) => {
    allExamples = list;
    renderFiltered();
  });

  return () => {
    root.remove();
  };
}

function getAtDotPath(obj, dotPath) {
  return dotPath.split('.').reduce((cur, seg) => cur?.[seg], obj);
}

function resolveToolUrls(value, filesystem) {
  if (!value || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (key === 'toolUrl' && typeof value[key] === 'string') {
      value[key] = filesystem.getUrlOfFile(value[key]);
    } else if (typeof value[key] === 'object' && value[key] !== null) {
      resolveToolUrls(value[key], filesystem);
    }
  }
  return value;
}
