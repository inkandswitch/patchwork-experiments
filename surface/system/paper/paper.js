import { useRef, For, render, html } from '../solid.js';
import { shapesSchema, selectedToolSchema, selectedShapesSchema } from './schema.js';

function ensurePaperDocument(ref) {
  ref.at('shapes').as(shapesSchema).value();
  ref.at('selectedTool').as(selectedToolSchema).value();
  ref.at('selectedShapes').as(selectedShapesSchema).value();
}

export default function mount(element) {
  const ref = element.ref;
  ensurePaperDocument(ref);

  const shapes = useRef(ref.at('shapes'));
  const selectedShapes = useRef(ref.at('selectedShapes'));

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
              ref-url=${ref.at('shapes', id).url}
            />
          </div>`
        }</>
      </div>`,
    element,
  );
}
