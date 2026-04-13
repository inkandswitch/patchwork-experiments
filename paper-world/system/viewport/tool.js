import { render, html, createSignal } from '../solid.js';
import { cameraSchema } from '../surface/schema.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

export default function mount(element) {
  const surface = element.findParent(cameraSchema);
  if (!surface) return;

  const [zoom, setZoom] = createSignal(surface.getCamera().zoom);

  const unsubscribeCamera = surface.subscribeCamera((cam) => {
    setZoom(cam.zoom);
  });

  const containerEl = surface.getContainerEl();
  if (containerEl) {
    containerEl.addEventListener('wheel', onWheel, { passive: false });
  }

  function onWheel(event) {
    if (isScrollableTarget(event, containerEl)) return;

    event.preventDefault();

    const rect = containerEl.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const cam = surface.getCamera();

    if (event.ctrlKey || event.metaKey) {
      const dy =
        Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 50);
      const newZoom = clampZoom(cam.zoom - (dy / 100) * cam.zoom);
      surface.setCamera({
        x: cam.x + screenX / newZoom - screenX / cam.zoom,
        y: cam.y + screenY / newZoom - screenY / cam.zoom,
        zoom: newZoom,
      });
    } else {
      surface.setCamera({
        x: cam.x - event.deltaX / cam.zoom,
        y: cam.y - event.deltaY / cam.zoom,
        zoom: cam.zoom,
      });
    }
  }

  function zoomBy(factor) {
    const cam = surface.getCamera();
    const newZoom = clampZoom(cam.zoom * factor);
    const rect = containerEl?.getBoundingClientRect();
    if (rect) {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      surface.setCamera({
        x: cam.x + cx / newZoom - cx / cam.zoom,
        y: cam.y + cy / newZoom - cy / cam.zoom,
        zoom: newZoom,
      });
    } else {
      surface.setCamera({ ...cam, zoom: newZoom });
    }
  }

  function resetZoom() {
    surface.setCamera({ x: 0, y: 0, zoom: 1 });
  }

  const cleanup = render(
    () =>
      html`<div
        style=${{
          display: 'flex',
          'align-items': 'center',
          gap: '2px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          'border-radius': '8px',
          padding: '2px',
          'box-shadow': '0 1px 3px rgba(0,0,0,0.08)',
          'font-family': 'system-ui, -apple-system, sans-serif',
          'font-size': '12px',
          'user-select': 'none',
          'pointer-events': 'auto',
        }}
      >
        <button
          onClick=${() => zoomBy(1 - ZOOM_STEP)}
          style=${buttonStyle}
          title="Zoom out"
        >
          −
        </button>
        <div
          onClick=${resetZoom}
          style=${{
            'min-width': '44px',
            'text-align': 'center',
            padding: '2px 4px',
            color: '#334155',
            cursor: 'pointer',
            'font-variant-numeric': 'tabular-nums',
          }}
          title="Reset zoom"
        >
          ${() => Math.round(zoom() * 100)}%
        </div>
        <button
          onClick=${() => zoomBy(1 + ZOOM_STEP)}
          style=${buttonStyle}
          title="Zoom in"
        >
          +
        </button>
      </div>`,
    element,
  );

  return () => {
    if (containerEl) {
      containerEl.removeEventListener('wheel', onWheel);
    }
    unsubscribeCamera();
    cleanup();
  };
}

function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function isScrollableTarget(event, surfaceContainer) {
  const path = event.composedPath();
  for (const el of path) {
    if (el === surfaceContainer) break;
    if (!(el instanceof HTMLElement)) continue;
    const { overflowY, overflowX } = getComputedStyle(el);
    const scrollableY =
      (overflowY === 'auto' || overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight;
    const scrollableX =
      (overflowX === 'auto' || overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth;
    if (scrollableY && event.deltaY !== 0) return true;
    if (scrollableX && event.deltaX !== 0) return true;
  }
  return false;
}

const buttonStyle = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  width: '24px',
  height: '24px',
  border: 'none',
  background: 'transparent',
  'border-radius': '6px',
  cursor: 'pointer',
  color: '#64748b',
  'font-size': '14px',
  'line-height': '1',
  padding: '0',
};
