import { render, html, createSignal, createEffect, from } from '../solid.js';
import { useRef } from '../solid.js';
import { surfaceSchema, selectedToolSchema } from '../surface/schema.js';

const MIN_SIZE = 20;
const DEFAULT_MARGIN = 6;
const ZONE_COLOR = 'rgba(139, 92, 246, 0.12)';
const ZONE_STROKE = 'rgba(139, 92, 246, 0.3)';

export default function mount(element) {
  const surface = element.findParent(surfaceSchema);
  if (!surface) return;

  const shapesRef = surface.getOrCreate(surfaceSchema);
  const selectedToolRef = surface.getOrCreate(selectedToolSchema);
  const shapes = useRef(shapesRef);
  const selectedTool = from(selectedToolRef);
  const containerEl = surface.getContainerEl();
  if (!containerEl) return;

  const selfUrl = element.getAttribute('ref-url') || '';

  function isResizable(id) {
    const shape = shapes[id];
    if (!shape) return false;
    if (shapesRef.at(id).at('data').url === selfUrl) return false;
    const d = shape.data;
    return typeof d?.width === 'number' && typeof d?.height === 'number';
  }

  function getShapeBounds(id) {
    const d = shapes[id]?.data;
    if (!d) return null;
    if (typeof d.width !== 'number' || typeof d.height !== 'number') return null;
    return { x: d.x ?? 0, y: d.y ?? 0, width: d.width, height: d.height };
  }

  function findShapeWrapperEl(id) {
    const targetUrl = shapesRef.at(id).at('data').url;
    const allRefViews = containerEl.querySelectorAll('ref-view');
    for (const refView of allRefViews) {
      if (refView.getAttribute('ref-url') !== targetUrl) continue;
      return refView.parentElement;
    }
    return null;
  }

  const [margin, setMargin] = createSignal(DEFAULT_MARGIN);
  const [showZones, setShowZones] = createSignal(false);
  const [enabled, setEnabled] = createSignal(true);

  let drag = null;

  function isSelectionToolActive() {
    return selectedTool() === 'selection';
  }

  function isResizeActive() {
    return enabled() && isSelectionToolActive();
  }

  function hitTest(clientX, clientY) {
    if (!isResizeActive()) return null;
    const page = surface.screenToPage(clientX, clientY);
    const zoom = surface.getCamera().zoom;
    const m = margin() / zoom;

    for (const id of Object.keys(shapes)) {
      if (!isResizable(id)) continue;
      const shape = getShapeBounds(id);
      if (!shape) continue;

      const left = shape.x;
      const top = shape.y;
      const right = left + shape.width;
      const bottom = top + shape.height;

      const inX = page.x >= left - m && page.x <= right + m;
      const inY = page.y >= top - m && page.y <= bottom + m;
      if (!inX || !inY) continue;

      const nearLeft = Math.abs(page.x - left) < m;
      const nearRight = Math.abs(page.x - right) < m;
      const nearTop = Math.abs(page.y - top) < m;
      const nearBottom = Math.abs(page.y - bottom) < m;

      if (nearTop && nearLeft) return { id, edge: 'nw', cursor: 'nwse-resize' };
      if (nearTop && nearRight) return { id, edge: 'ne', cursor: 'nesw-resize' };
      if (nearBottom && nearLeft) return { id, edge: 'sw', cursor: 'nesw-resize' };
      if (nearBottom && nearRight) return { id, edge: 'se', cursor: 'nwse-resize' };
      if (nearTop) return { id, edge: 'n', cursor: 'ns-resize' };
      if (nearBottom) return { id, edge: 's', cursor: 'ns-resize' };
      if (nearLeft) return { id, edge: 'w', cursor: 'ew-resize' };
      if (nearRight) return { id, edge: 'e', cursor: 'ew-resize' };
    }
    return null;
  }

  function onMouseMove(event) {
    if (drag) return;
    if (!isResizeActive()) {
      containerEl.style.cursor = '';
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    containerEl.style.cursor = hit ? hit.cursor : '';
  }

  function onMouseDown(event) {
    if (event.button !== 0) return;
    if (!isResizeActive()) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (!hit) return;

    event.preventDefault();
    event.stopPropagation();

    const shape = getShapeBounds(hit.id);
    if (!shape) return;
    drag = {
      id: hit.id,
      edge: hit.edge,
      startX: event.clientX,
      startY: event.clientY,
      origX: shape.x,
      origY: shape.y,
      origW: shape.width,
      origH: shape.height,
    };

    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', onDragEnd, true);
  }

  function onDragMove(event) {
    if (!drag) return;
    event.preventDefault();

    const startPage = surface.screenToPage(drag.startX, drag.startY);
    const nowPage = surface.screenToPage(event.clientX, event.clientY);
    const dx = nowPage.x - startPage.x;
    const dy = nowPage.y - startPage.y;

    let { origX, origY, origW, origH } = drag;
    let newX = origX;
    let newY = origY;
    let newW = origW;
    let newH = origH;

    const edge = drag.edge;
    if (edge.includes('e')) newW = origW + dx;
    if (edge.includes('w')) { newW = origW - dx; newX = origX + dx; }
    if (edge.includes('s')) newH = origH + dy;
    if (edge.includes('n')) { newH = origH - dy; newY = origY + dy; }

    if (newW < MIN_SIZE) {
      if (edge.includes('w')) newX = origX + origW - MIN_SIZE;
      newW = MIN_SIZE;
    }
    if (newH < MIN_SIZE) {
      if (edge.includes('n')) newY = origY + origH - MIN_SIZE;
      newH = MIN_SIZE;
    }

    shapesRef.at(drag.id).change((shape) => {
      if (!shape.data) shape.data = {};
      shape.data.x = newX;
      shape.data.y = newY;
      shape.data.width = newW;
      shape.data.height = newH;
    });
  }

  function onDragEnd() {
    drag = null;
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragEnd, true);
    containerEl.style.cursor = '';
  }

  containerEl.addEventListener('mousemove', onMouseMove);
  containerEl.addEventListener('mousedown', onMouseDown, true);

  // Resize zone overlay — rendered in page coords inside the camera transform layer
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
  overlay.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const transformLayer = containerEl.firstElementChild;
  if (transformLayer) transformLayer.appendChild(overlay);

  createEffect(() => {
    const visible = showZones() && isResizeActive();
    const m = margin();
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    if (!visible) return;

    for (const id of Object.keys(shapes)) {
      if (!isResizable(id)) continue;
      const shape = getShapeBounds(id);
      if (!shape) continue;

      const ox = shape.x - m;
      const oy = shape.y - m;
      const ow = shape.width + m * 2;
      const oh = shape.height + m * 2;
      const ix = shape.x;
      const iy = shape.y;
      const iw = shape.width;
      const ih = shape.height;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d',
        `M${ox},${oy} h${ow} v${oh} h${-ow}Z ` +
        `M${ix},${iy} v${ih} h${iw} v${-ih}Z`
      );
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('fill', ZONE_COLOR);
      path.setAttribute('stroke', ZONE_STROKE);
      path.setAttribute('stroke-width', '0.5');
      overlay.appendChild(path);
    }
  });

  // Tangle-style scrub for the margin value
  function onScrubDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startVal = margin();

    function onScrubMove(e) {
      const delta = Math.round((e.clientX - startX) / 4);
      setMargin(Math.max(2, Math.min(20, startVal + delta)));
    }
    function onScrubUp() {
      document.removeEventListener('mousemove', onScrubMove);
      document.removeEventListener('mouseup', onScrubUp);
    }
    document.addEventListener('mousemove', onScrubMove);
    document.addEventListener('mouseup', onScrubUp);
  }

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
    border: '2px solid #e2e8f0',
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
          onMouseEnter=${() => isResizeActive() && setShowZones(true)}
          onMouseLeave=${() => setShowZones(false)}
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
          <div style=${cardStyle}>
            ${flipCorner((e) => { e.stopPropagation(); setEnabled(false); setShowZones(false); })}
            <div
              style=${{
                flex: '1',
                background: 'linear-gradient(135deg, #fdf2f8 0%, #faf5ff 50%, #f0f9ff 100%)',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
              }}
            >
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <!-- inner rectangle -->
                <rect x="22" y="22" width="36" height="36" rx="4" fill="#fff" stroke="#1e293b" stroke-width="2" />
                <!-- outer resize boundary -->
                <rect x="14" y="14" width="52" height="52" rx="7" fill="none" stroke="#8b5cf6" stroke-width="3" />
                <!-- arrows -->
                <line x1="40" y1="10" x2="40" y2="2" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" />
                <polyline points="36,6 40,2 44,6" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                <line x1="40" y1="70" x2="40" y2="78" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" />
                <polyline points="36,74 40,78 44,74" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                <line x1="10" y1="40" x2="2" y2="40" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" />
                <polyline points="6,36 2,40 6,44" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                <line x1="70" y1="40" x2="78" y2="40" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" />
                <polyline points="74,36 78,40 74,44" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <div
              style=${{
                padding: '8px 10px',
                'border-top': '1px solid #f1f5f9',
                background: '#fafafa',
                'font-size': '11px',
                color: '#64748b',
                'line-height': '1.3',
              }}
            >
              Resize within${' '}
              <span
                onMouseDown=${onScrubDown}
                style=${{
                  color: '#7c3aed',
                  'font-weight': '600',
                  'border-bottom': '1px dashed #7c3aed',
                  cursor: 'ew-resize',
                  padding: '0 1px',
                }}
                title="Drag to adjust edge margin"
              >
                ${() => margin()}px
              </span>
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
              <rect x="22" y="22" width="36" height="36" rx="4" stroke="#94a3b8" stroke-width="2" fill="none" />
              <rect x="14" y="14" width="52" height="52" rx="7" stroke="#94a3b8" stroke-width="3" fill="none" />
            </svg>
            <div style=${{ 'font-size': '12px', color: '#94a3b8', 'font-weight': '500' }}>Resize</div>
          </div>
        </div>
      </div>`,
    element,
  );

  return () => {
    containerEl.removeEventListener('mousemove', onMouseMove);
    containerEl.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragEnd, true);
    containerEl.style.cursor = '';
    overlay.remove();
    cleanup();
  };
}
