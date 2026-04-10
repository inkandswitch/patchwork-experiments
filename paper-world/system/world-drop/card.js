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
          width: '180px',
          height: '110px',
          border: active() ? '2px solid #3b82f6' : '2px solid #e2e8f0',
          'border-radius': '12px',
          background: active() ? '#eff6ff' : '#fff',
          'box-shadow': active()
            ? '0 0 20px rgba(59,130,246,0.3), 0 2px 8px rgba(0,0,0,0.06)'
            : '0 1px 4px rgba(0,0,0,0.06)',
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          gap: '6px',
          padding: '12px',
          'font-family': 'system-ui, -apple-system, sans-serif',
          transition: 'border-color 0.2s, background 0.2s, box-shadow 0.3s',
          'user-select': 'none',
          position: 'relative',
        })}
      >
        <div
          style=${{
            position: 'absolute',
            top: '4px',
            right: '6px',
            'font-size': '8px',
            color: '#c0c5cc',
          }}
        >
          v4
        </div>
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke=${() => (active() ? '#3b82f6' : '#94a3b8')}
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="transition: stroke 0.2s"
        >
          <rect x="4" y="12" width="16" height="10" rx="2" />
          <path d="M12 2v12" />
          <path d="M8 10l4 4 4-4" />
        </svg>
        <div
          style=${{
            'font-size': '12px',
            'font-weight': '600',
            color: '#334155',
          }}
        >
          Import Worlds
        </div>
        <div
          style=${{
            'font-size': '9px',
            color: '#94a3b8',
            'text-align': 'center',
            'line-height': '1.3',
          }}
        >
          Drop Paper World docs to embed
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
