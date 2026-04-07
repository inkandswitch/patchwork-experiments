import { useRef, For, render, html } from '../solid.js';
import { shapesSchema, selectedShapesSchema } from './schema.js';

export default function mount(element) {
  const shapesRef = element.getOrCreate(shapesSchema);
  const selectedShapesRef = element.getOrCreate(selectedShapesSchema);

  const shapes = useRef(shapesRef);
  const selectedShapes = useRef(selectedShapesRef);

  return render(
    () =>
      html`<div style=${{ position: 'relative', width: '100%', height: '100%' }}>
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
