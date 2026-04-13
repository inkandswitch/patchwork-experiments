import { useRef, For, render, html, createSignal } from '../solid.js';
import { surfaceSchema, selectedShapesSchema } from '../surface/schema.js';

export default function mount(element) {
  const shapesRef = element.getOrCreate(surfaceSchema);
  const selectedShapesRef = element.getOrCreate(selectedShapesSchema);

  const shapes = useRef(shapesRef);
  const selectedShapes = useRef(selectedShapesRef);
  const [camera, setCamera] = createSignal({ x: 0, y: 0, zoom: 1 });
  const cameraListeners = new Set();

  let containerEl = null;

  function screenToPage(clientX, clientY) {
    const rect = containerEl
      ? containerEl.getBoundingClientRect()
      : element.getBoundingClientRect();
    const el = containerEl || element;
    const scaleX = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    const scaleY = el.offsetHeight ? rect.height / el.offsetHeight : 1;
    const cam = camera();
    return {
      x: (clientX - rect.left) / (cam.zoom * scaleX) - cam.x,
      y: (clientY - rect.top) / (cam.zoom * scaleY) - cam.y,
    };
  }

  function pageToScreen(pageX, pageY) {
    const rect = containerEl
      ? containerEl.getBoundingClientRect()
      : element.getBoundingClientRect();
    const el = containerEl || element;
    const scaleX = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    const scaleY = el.offsetHeight ? rect.height / el.offsetHeight : 1;
    const cam = camera();
    return {
      x: (pageX + cam.x) * cam.zoom * scaleX + rect.left,
      y: (pageY + cam.y) * cam.zoom * scaleY + rect.top,
    };
  }

  function updateCamera(cam) {
    setCamera(cam);
    for (const fn of cameraListeners) fn(cam);
  }

  element.screenToPage = screenToPage;
  element.pageToScreen = pageToScreen;
  element.getCamera = () => camera();
  element.setCamera = updateCamera;
  element.subscribeCamera = (fn) => {
    fn(camera());
    cameraListeners.add(fn);
    return () => cameraListeners.delete(fn);
  };
  element.getContainerEl = () => containerEl;
  element.getScale = () => {
    const rect = containerEl
      ? containerEl.getBoundingClientRect()
      : element.getBoundingClientRect();
    const el = containerEl || element;
    const ancestorScale = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    return camera().zoom * ancestorScale;
  };

  let dragging = false;

  function setContainerRef(el) {
    containerEl = el;
    el.addEventListener('pointerdown', () => { dragging = true; });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
    el.addEventListener('selectstart', (e) => {
      if (dragging) e.preventDefault();
    });
  }

  const cleanup = render(
    () =>
      html`<div
        ref=${setContainerRef}
        style=${{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
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
              style=${() => {
                const d = shapes[id]?.data;
                return {
                  position: 'absolute',
                  left: `${d?.x}px`,
                  top: `${d?.y}px`,
                  'z-index': d?.z ?? 0,
                  ...(d?.width != null ? { width: `${d.width}px` } : {}),
                  ...(d?.height != null ? { height: `${d.height}px` } : {}),
                  ...(d?.scale != null && d?.scale !== 1
                    ? { transform: `scale(${d.scale})`, 'transform-origin': '0 0' }
                    : {}),
                  filter: selectedShapes[id] ? 'drop-shadow(0 0 3px rgba(0,0,0,0.4))' : 'none',
                };
              }}
            >
              <ref-view
                view-url=${() => shapes[id]?.viewUrl}
                ref-url=${shapesRef.at(id).at('data').url}
              />
            </div>`
          }</>
        </div>
      </div>`,
    element,
  );

  return () => {
    delete element.screenToPage;
    delete element.pageToScreen;
    delete element.getCamera;
    delete element.setCamera;
    delete element.subscribeCamera;
    delete element.getContainerEl;
    delete element.getScale;
    cleanup();
  };
}
