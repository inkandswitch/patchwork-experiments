import { useRef, For, render, html } from '../solid.js';
import { shapesSchema, selectedShapesSchema } from './schema.js';

const MIME = 'text/x-patchwork-ref-url';

export default function mount(element) {
  const shapesRef = element.getOrCreate(shapesSchema);
  const selectedShapesRef = element.getOrCreate(selectedShapesSchema);

  const shapes = useRef(shapesRef);
  const selectedShapes = useRef(selectedShapesRef);

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

    const rect = event.currentTarget.getBoundingClientRect();
    const dropX = event.clientX - rect.left;
    const dropY = event.clientY - rect.top;

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

  return render(
    () =>
      html`<div
        style=${{ position: 'relative', width: '100%', height: '100%' }}
        onDragOver=${onCanvasDragOver}
        onDrop=${onCanvasDrop}
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
      </div>`,
    element,
  );
}
