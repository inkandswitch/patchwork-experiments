import { render, html, createSignal } from '../solid.js';
import { getViewUrl } from '../url.js';
import { surfaceSchema } from '../surface/schema.js';

const URLS_MIME = 'text/x-patchwork-urls';
const SHAPE_MIME = 'text/x-patchwork-shape';
// Horizontal spacing between shapes when multiple items are dropped at once
const DIRECT_DROP_OFFSET_X = 40;
const EMBED_DROP_OFFSET_X = 440;

export default function mount(element) {
  const surface = element.findParent(surfaceSchema);
  if (!surface) return;

  const shapesRef = surface.getOrCreate(surfaceSchema);
  const [active, setActive] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const embedViewUrl = getViewUrl('../embed/tool.json', import.meta.url);

  let dragTimer = null;

  function onDragOver(event) {
    if (!enabled()) return;
    if (!supportsDropType(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => setActive(false), 150);
  }

  async function onDrop(event) {
    if (!enabled()) return;
    if (!supportsDropType(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    clearTimeout(dragTimer);

    const repo = globalThis.repo;
    if (!repo) return;

    const dropPos =
      typeof surface.screenToPage === 'function'
        ? surface.screenToPage(event.clientX, event.clientY)
        : { x: 100, y: 100 };
    const droppedEntries = await getDroppedEntries(event.dataTransfer, repo);
    if (droppedEntries.length === 0) return;

    let offsetX = 0;
    for (const entry of droppedEntries) {
      const shape = await buildDroppedShapeValue(repo, entry, embedViewUrl, dropPos.x + offsetX, dropPos.y);
      if (!shape) continue;
      const shapeId = `drop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      shapesRef.at(shapeId).change(() => shape);
      offsetX += entry.kind === 'embed' ? EMBED_DROP_OFFSET_X : DIRECT_DROP_OFFSET_X;
    }
  }

  function onDragEnd() {
    setActive(false);
    clearTimeout(dragTimer);
  }

  surface.addEventListener('dragover', onDragOver);
  surface.addEventListener('drop', onDrop);
  surface.addEventListener('dragend', onDragEnd);

  function flipCorner(onClick) {
    return html`<div
      onClick=${onClick}
      style=${{
        position: 'absolute',
        top: '4px',
        left: '4px',
        width: '18px',
        height: '18px',
        'z-index': '10',
        cursor: 'pointer',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'border-radius': '4px',
        opacity: '0.4',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter=${(e) => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave=${(e) => { e.currentTarget.style.opacity = '0.4'; }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 7.5 C2 4, 4 2, 7.5 2" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" fill="none" />
        <polyline points="5.5,1 7.5,2 5.5,3" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>`;
  }

  const cardStyle = {
    width: '140px',
    height: '196px',
    'border-radius': '10px',
    background: '#fff',
    'box-shadow': '0 2px 8px rgba(0,0,0,0.08)',
    display: 'flex',
    'flex-direction': 'column',
    overflow: 'hidden',
    'font-family': 'system-ui, -apple-system, sans-serif',
    'user-select': 'none',
    'backface-visibility': 'hidden',
    position: 'absolute',
    inset: '0',
  };

  const cleanup = render(
    () =>
      html`<div
        style=${{ width: '140px', height: '196px', perspective: '600px' }}
      >
        <div
          style=${() => ({
            position: 'relative',
            width: '100%',
            height: '100%',
            'transform-style': 'preserve-3d',
            'transform-origin': 'center',
            transition: 'transform 0.5s',
            transform: enabled() ? 'rotateY(0deg)' : 'rotateY(180deg)',
          })}
        >
          <!-- front face -->
          <div
            style=${() => ({
              ...cardStyle,
              border: active() ? '2px solid #3b82f6' : '2px solid #e2e8f0',
              transition: 'border-color 0.2s, box-shadow 0.3s',
            })}
          >
            ${flipCorner((e) => { e.stopPropagation(); setEnabled(false); })}
            <div
              style=${() => ({
                flex: '1',
                background: active()
                  ? 'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 50%, #dbeafe 100%)'
                  : 'linear-gradient(135deg, #f0f9ff 0%, #f5f3ff 50%, #f0f9ff 100%)',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                transition: 'background 0.3s',
              })}
            >
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="18" y="14" width="36" height="28" rx="3" fill=${() => (active() ? '#bfdbfe' : '#e2e8f0')} stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1" />
                <rect x="22" y="10" width="36" height="28" rx="3" fill=${() => (active() ? '#dbeafe' : '#f1f5f9')} stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1" />
                <rect x="26" y="6" width="36" height="28" rx="3" fill="#fff" stroke=${() => (active() ? '#60a5fa' : '#94a3b8')} stroke-width="1.5" />
                <line x1="32" y1="14" x2="56" y2="14" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" />
                <line x1="32" y1="19" x2="50" y2="19" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" />
                <line x1="32" y1="24" x2="53" y2="24" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" />
                <line x1="40" y1="46" x2="40" y2="66" stroke=${() => (active() ? '#3b82f6' : '#94a3b8')} stroke-width="2" stroke-linecap="round" />
                <polyline points="34,60 40,68 46,60" fill="none" stroke=${() => (active() ? '#3b82f6' : '#94a3b8')} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <div style=${{ padding: '8px 10px', 'border-top': '1px solid #f1f5f9', background: '#fafafa', 'font-size': '11px', color: '#64748b', 'line-height': '1.3' }}>
              Drop shapes or docs
            </div>
          </div>
          <!-- back face -->
          <div
            style=${{
              ...cardStyle,
              transform: 'rotateY(180deg)',
              background: '#f1f5f9',
              border: '2px solid #e2e8f0',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '8px',
            }}
          >
            ${flipCorner((e) => { e.stopPropagation(); setEnabled(true); })}
            <svg width="40" height="40" viewBox="0 0 80 80" fill="none" style="opacity:0.3">
              <rect x="22" y="10" width="36" height="28" rx="3" stroke="#94a3b8" stroke-width="2" fill="none" />
              <line x1="28" y1="18" x2="52" y2="18" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
              <line x1="28" y1="24" x2="46" y2="24" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
              <line x1="40" y1="46" x2="40" y2="66" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
              <polyline points="34,60 40,68 46,60" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div style=${{ 'font-size': '12px', color: '#94a3b8', 'font-weight': '500' }}>Import</div>
          </div>
        </div>
      </div>`,
    element,
  );

  return () => {
    surface.removeEventListener('dragover', onDragOver);
    surface.removeEventListener('drop', onDrop);
    surface.removeEventListener('dragend', onDragEnd);
    clearTimeout(dragTimer);
    cleanup();
  };
}

function isPaperWorldDoc(doc) {
  return (
    doc &&
    typeof doc === 'object' &&
    typeof doc.title === 'string' &&
    typeof doc.sourceFolderUrl === 'string' &&
    typeof doc.frameDocUrl === 'string'
  );
}

function supportsDropType(dataTransfer) {
  return (
    dataTransfer.types.includes(SHAPE_MIME) ||
    dataTransfer.types.includes(URLS_MIME)
  );
}

async function getDroppedEntries(dataTransfer, repo) {
  if (dataTransfer.types.includes(SHAPE_MIME)) {
    return getEntriesFromShapePayload(dataTransfer.getData(SHAPE_MIME));
  }

  if (dataTransfer.types.includes(URLS_MIME)) {
    return getEntriesFromWorldUrls(dataTransfer.getData(URLS_MIME), repo);
  }

  return [];
}

function getEntriesFromShapePayload(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const entry = normalizeDroppedEntry(parsed?.value, parsed?.viewUrl, parsed?.title, parsed?.width, parsed?.height);
    return entry ? [entry] : [];
  } catch {
    return [];
  }
}

async function getEntriesFromWorldUrls(raw, repo) {
  if (!raw) return [];

  let urls;
  try {
    urls = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(urls)) return [];

  const entries = [];
  for (const url of urls) {
    const entry = await getEntryFromWorldUrl(url, repo);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function getEntryFromWorldUrl(url, repo) {
  if (typeof url !== 'string' || !url.startsWith('automerge:')) return null;

  try {
    const handle = await repo.find(url);
    if (typeof handle.whenReady === 'function') await handle.whenReady();
    const doc = handle.doc();

    if (isPaperWorldDoc(doc)) {
      if (typeof doc.toolUrl !== 'string' || !doc.toolUrl) return null;
      const frameHandle = await repo.find(doc.frameDocUrl);
      if (typeof frameHandle.whenReady === 'function') await frameHandle.whenReady();
      const frameValue = structuredClone(frameHandle.doc());
      return normalizeDroppedEntry(frameValue, doc.toolUrl, doc.title || 'Paper World');
    }

    return normalizeDroppedEntry(structuredClone(doc), doc?.viewUrl, doc?.title);
  } catch {
    return null;
  }
}

function normalizeDroppedEntry(value, viewUrl, title, width, height) {
  if (!value || typeof value !== 'object') return null;

  const normalizedViewUrl =
    typeof viewUrl === 'string' && viewUrl
      ? viewUrl
      : typeof value.viewUrl === 'string' && value.viewUrl
        ? value.viewUrl
        : '';

  if (looksLikeShapeValue(value, normalizedViewUrl)) {
    return {
      kind: 'shape',
      value: structuredClone(value),
      viewUrl: normalizedViewUrl,
      title,
      width,
      height,
    };
  }

  if (!normalizedViewUrl) return null;

  return {
    kind: 'embed',
    value: stripShapePlacementFields(structuredClone(value)),
    viewUrl: normalizedViewUrl,
    title: typeof title === 'string' && title ? title : 'Embedded tool',
    width,
    height,
  };
}

async function buildDroppedShapeValue(repo, entry, embedViewUrl, x, y) {
  if (entry.kind === 'shape') {
    const data = stripShapePlacementFields(structuredClone(entry.value));
    data.x = x;
    data.y = y;
    return { viewUrl: entry.viewUrl, data };
  }

  const handle = repo.create(structuredClone(entry.value));
  return {
    viewUrl: embedViewUrl,
    data: {
      x,
      y,
      embedDocUrl: handle.url,
      embedToolUrl: entry.viewUrl,
      title: entry.title,
      width: entry.width ?? 420,
      height: entry.height ?? 320,
    },
  };
}

function stripShapePlacementFields(value) {
  delete value._trayWidth;
  delete value._trayHeight;
  return value;
}

function looksLikeShapeValue(value, viewUrl) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof viewUrl === 'string' &&
    viewUrl !== ''
  );
}
