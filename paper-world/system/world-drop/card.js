import { render, html, createSignal } from '../solid.js';
import { getViewUrl } from '../url.js';
import { shapesSchema } from '../paper/schema.js';

const URLS_MIME = 'text/x-patchwork-urls';

export default function mount(element) {
  const canvas = element.findParent(shapesSchema);
  console.log('[world-drop] mount, canvas:', canvas?.tagName, !!canvas);
  if (!canvas) return;

  const shapesRef = canvas.getOrCreate(shapesSchema);
  const [active, setActive] = createSignal(false);
  const embedViewUrl = getViewUrl('../embed/tool.json', import.meta.url);
  console.log('[world-drop] embedViewUrl:', embedViewUrl);

  let dragTimer = null;

  function isOverCanvas(event) {
    const target = event.target;
    if (target === canvas) return true;
    if (target instanceof Node && canvas.contains(target)) return true;
    return false;
  }

  function onDragOver(event) {
    if (!event.dataTransfer.types.includes(URLS_MIME)) return;
    if (!isOverCanvas(event)) return;
    console.log('[world-drop] dragover MATCHED, target:', event.target?.tagName);
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => setActive(false), 150);
  }

  async function onDrop(event) {
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

  console.log('[world-drop] attaching document-level capture listeners');
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragend', onDragEnd);

  const cleanup = render(
    () =>
      html`<div
        style=${() => ({
          width: '140px',
          height: '196px',
          'border-radius': '10px',
          border: active() ? '2px solid #3b82f6' : '2px solid #e2e8f0',
          background: '#fff',
          'box-shadow': active()
            ? '0 0 20px rgba(59,130,246,0.25), 0 4px 12px rgba(0,0,0,0.1)'
            : '0 2px 8px rgba(0,0,0,0.08)',
          display: 'flex',
          'flex-direction': 'column',
          overflow: 'hidden',
          'font-family': 'system-ui, -apple-system, sans-serif',
          transition: 'border-color 0.2s, box-shadow 0.3s',
          'user-select': 'none',
        })}
      >
        <!-- illustration area -->
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
          <svg
            width="80"
            height="80"
            viewBox="0 0 80 80"
            fill="none"
            style="transition: opacity 0.2s"
          >
            <!-- stacked document layers -->
            <rect
              x="18"
              y="14"
              width="36"
              height="28"
              rx="3"
              fill=${() => (active() ? '#bfdbfe' : '#e2e8f0')}
              stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')}
              stroke-width="1"
              style="transition: fill 0.2s, stroke 0.2s"
            />
            <rect
              x="22"
              y="10"
              width="36"
              height="28"
              rx="3"
              fill=${() => (active() ? '#dbeafe' : '#f1f5f9')}
              stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')}
              stroke-width="1"
              style="transition: fill 0.2s, stroke 0.2s"
            />
            <rect
              x="26"
              y="6"
              width="36"
              height="28"
              rx="3"
              fill="#fff"
              stroke=${() => (active() ? '#60a5fa' : '#94a3b8')}
              stroke-width="1.5"
              style="transition: stroke 0.2s"
            />
            <!-- lines on top doc -->
            <line x1="32" y1="14" x2="56" y2="14" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" style="transition: stroke 0.2s" />
            <line x1="32" y1="19" x2="50" y2="19" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" style="transition: stroke 0.2s" />
            <line x1="32" y1="24" x2="53" y2="24" stroke=${() => (active() ? '#93c5fd' : '#cbd5e1')} stroke-width="1.5" stroke-linecap="round" style="transition: stroke 0.2s" />
            <!-- arrow pointing down into canvas -->
            <line
              x1="40"
              y1="46"
              x2="40"
              y2="66"
              stroke=${() => (active() ? '#3b82f6' : '#94a3b8')}
              stroke-width="2"
              stroke-linecap="round"
              style="transition: stroke 0.2s"
            />
            <polyline
              points="34,60 40,68 46,60"
              fill="none"
              stroke=${() => (active() ? '#3b82f6' : '#94a3b8')}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="transition: stroke 0.2s"
            />
          </svg>
        </div>
        <!-- label strip -->
        <div
          style=${{
            padding: '8px 10px',
            'border-top': '1px solid #f1f5f9',
            background: '#fafafa',
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
          }}
        >
          <div
            style=${{
              'font-size': '11px',
              color: '#64748b',
              'line-height': '1.3',
            }}
          >
            Drop docs to embed
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
