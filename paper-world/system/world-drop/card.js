import { render, html, createSignal } from '../solid.js';
import { getViewUrl } from '../url.js';
import { shapesSchema } from '../paper/schema.js';

const URLS_MIME = 'text/x-patchwork-urls';

export default function mount(element) {
  const canvas = element.findParent(shapesSchema);
  if (!canvas) return;

  const shapesRef = canvas.getOrCreate(shapesSchema);
  const [active, setActive] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);
  const embedViewUrl = getViewUrl('../embed/tool.json', import.meta.url);

  let dragTimer = null;

  function isOverCanvas(event) {
    const target = event.target;
    if (target === canvas) return true;
    if (target instanceof Node && canvas.contains(target)) return true;
    return false;
  }

  function onDragOver(event) {
    if (!enabled()) return;
    if (!event.dataTransfer.types.includes(URLS_MIME)) return;
    if (!isOverCanvas(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => setActive(false), 150);
  }

  async function onDrop(event) {
    if (!enabled()) return;
    if (!event.dataTransfer.types.includes(URLS_MIME)) return;
    if (!isOverCanvas(event)) return;

    const raw = event.dataTransfer.getData(URLS_MIME);
    console.log('[world-drop] drop, raw:', raw);
    if (!raw) return;

    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    clearTimeout(dragTimer);

    let urls;
    try {
      urls = JSON.parse(raw);
    } catch (err) {
      console.log('[world-drop] JSON parse error:', err);
      return;
    }
    console.log('[world-drop] parsed urls:', urls);
    if (!Array.isArray(urls)) return;

    const repo = globalThis.repo;
    if (!repo) return;

    const dropPos =
      typeof canvas.screenToPage === 'function'
        ? canvas.screenToPage(event.clientX, event.clientY)
        : { x: 100, y: 100 };
    console.log('[world-drop] dropPos:', dropPos);

    let offsetX = 0;
    for (const url of urls) {
      if (typeof url !== 'string' || !url.startsWith('automerge:')) {
        console.log('[world-drop] skipping non-automerge url:', url);
        continue;
      }
      try {
        console.log('[world-drop] looking up:', url);
        const handle = await repo.find(url);
        if (typeof handle.whenReady === 'function') await handle.whenReady();
        const doc = handle.doc();
        console.log('[world-drop] doc:', doc, 'isPaperWorld:', isPaperWorldDoc(doc));
        if (!isPaperWorldDoc(doc)) continue;

        const shapeId = `world_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        console.log('[world-drop] creating shape:', shapeId, { embedDocUrl: url, embedToolUrl: doc.toolUrl, title: doc.title });
        shapesRef.at(shapeId).change(() => ({
          x: dropPos.x + offsetX,
          y: dropPos.y,
          viewUrl: embedViewUrl,
          embedDocUrl: url,
          embedToolUrl: doc.toolUrl || '',
          title: doc.title || 'Paper World',
          width: 400,
          height: 300,
        }));
        offsetX += 420;
      } catch (err) {
        console.log('[world-drop] error processing url:', url, err);
      }
    }
  }

  function onDragEnd() {
    setActive(false);
    clearTimeout(dragTimer);
  }

  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragend', onDragEnd);

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
              Drop docs to embed
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
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('drop', onDrop, true);
    document.removeEventListener('dragend', onDragEnd);
    clearTimeout(dragTimer);
    cleanup();
  };
}

function isPaperWorldDoc(doc) {
  return (
    doc &&
    typeof doc === 'object' &&
    typeof doc.title === 'string' &&
    typeof doc.sourceFolderUrl === 'string'
  );
}
