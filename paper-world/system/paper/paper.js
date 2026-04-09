import { useRef, For, render, html, createSignal } from '../solid.js';
import { shapesSchema, selectedShapesSchema } from './schema.js';

const MIME = 'text/x-patchwork-ref-url';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export default function mount(element) {
  const shapesRef = element.getOrCreate(shapesSchema);
  const selectedShapesRef = element.getOrCreate(selectedShapesSchema);

  const shapes = useRef(shapesRef);
  const selectedShapes = useRef(selectedShapesRef);
  const [camera, setCamera] = createSignal({ x: 0, y: 0, zoom: 1 });

  let containerEl = null;

  function screenToPage(clientX, clientY) {
    const rect = containerEl
      ? containerEl.getBoundingClientRect()
      : element.getBoundingClientRect();
    const cam = camera();
    return {
      x: (clientX - rect.left) / cam.zoom - cam.x,
      y: (clientY - rect.top) / cam.zoom - cam.y,
    };
  }

  function pageToScreen(pageX, pageY) {
    const rect = containerEl
      ? containerEl.getBoundingClientRect()
      : element.getBoundingClientRect();
    const cam = camera();
    return {
      x: (pageX + cam.x) * cam.zoom + rect.left,
      y: (pageY + cam.y) * cam.zoom + rect.top,
    };
  }

  element.screenToPage = screenToPage;
  element.pageToScreen = pageToScreen;

  function onWheel(event) {
    event.preventDefault();

    console.log('[paper] onWheel fired', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      containerEl: !!containerEl,
    });

    const rect = containerEl.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const cam = camera();

    console.log('[paper] camera before:', cam);

    if (event.ctrlKey || event.metaKey) {
      const dy = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 50);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom - (dy / 100) * cam.zoom));
      const newCam = {
        x: cam.x + screenX / newZoom - screenX / cam.zoom,
        y: cam.y + screenY / newZoom - screenY / cam.zoom,
        zoom: newZoom,
      };
      console.log('[paper] zoom setCamera:', newCam);
      setCamera(newCam);
    } else {
      const newCam = {
        x: cam.x - event.deltaX / cam.zoom,
        y: cam.y - event.deltaY / cam.zoom,
        zoom: cam.zoom,
      };
      console.log('[paper] pan setCamera:', newCam);
      setCamera(newCam);
    }

    console.log('[paper] camera after:', camera());
  }

  function onCanvasDragOver(event) {
    if (event.dataTransfer.types.includes(MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onCanvasDrop(event) {
    const refUrl = event.dataTransfer.getData(MIME);
    if (!refUrl) return;

    event.preventDefault();
    event.stopPropagation();

    const { x: dropX, y: dropY } = screenToPage(event.clientX, event.clientY);

    element.findRef(refUrl).then((ref) => {
      const data = ref.value();
      if (!data || !data.viewUrl) return;

      const clone = structuredClone(data);
      clone.x = dropX;
      clone.y = dropY;
      delete clone._trayWidth;
      delete clone._trayHeight;

      const shapeId = `drop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      shapesRef.at(shapeId).change(() => clone);
    }).catch(() => {});
  }

  function setContainerRef(el) {
    console.log('[paper] setContainerRef called', el?.tagName, el === containerEl ? '(same)' : '(new)');
    if (containerEl === el) return;
    if (containerEl) {
      containerEl.removeEventListener('wheel', onWheel);
    }
    containerEl = el;
    if (el) {
      console.log('[paper] adding wheel listener to container');
      el.addEventListener('wheel', onWheel, { passive: false });
    }
  }

  const cleanup = render(
    () =>
      html`<div
        ref=${setContainerRef}
        style=${{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
        onDragOver=${onCanvasDragOver}
        onDrop=${onCanvasDrop}
      >
        <div
          style=${() => {
            const cam = camera();
            return {
              'transform-origin': '0 0',
              transform: `scale(${cam.zoom}) translate(${cam.x}px, ${cam.y}px)`,
              position: 'absolute',
              inset: '0',
            };
          }}
        >
          <${For} each=${() => Object.keys(shapes)}>${(id) =>
            html`<div
              style=${() => ({
                position: 'absolute',
                left: `${shapes[id]?.x}px`,
                top: `${shapes[id]?.y}px`,
                'z-index': shapes[id]?.z ?? 0,
                filter: selectedShapes[id] ? 'drop-shadow(0 0 3px rgba(0,0,0,0.4))' : 'none',
              })}
            >
              <ref-view
                view-url=${() => shapes[id]?.viewUrl}
                ref-url=${shapesRef.at(id).url}
              />
            </div>`
          }</>
        </div>
      </div>`,
    element,
  );

  return () => {
    if (containerEl) {
      containerEl.removeEventListener('wheel', onWheel);
    }
    delete element.screenToPage;
    delete element.pageToScreen;
    cleanup();
  };
}
