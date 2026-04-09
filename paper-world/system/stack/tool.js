import { render, html, useRef, For } from '../solid.js';
import stackSchema from './schema.js';

export default function mount(element) {
  const stackRef = element.getOrCreate(stackSchema);
  const stack = useRef(stackRef);

  let containerEl = null;

  function getChildRefViews() {
    if (!containerEl) return [];
    return Array.from(containerEl.querySelectorAll(':scope > div > ref-view'));
  }

  function findChildWith(schema) {
    for (const child of getChildRefViews()) {
      if (child.has && child.has(schema)) return child;
    }
    return null;
  }

  // Monkey-patch the stack's ref-view element so that schema lookups
  // transparently delegate to whichever child owns the schema. This lets
  // deeply nested tools (e.g. a button inside the dock-layout) call
  // element.findParent(shapesSchema) and receive the *paper* ref-view
  // rather than the stack, because findParent delegates up to the stack's
  // findClosest, which checks children first via findChildWith.
  const origFindClosest = element.findClosest.bind(element);
  const origHas = element.has.bind(element);
  const origGet = element.get.bind(element);
  const origGetOrCreate = element.getOrCreate.bind(element);

  element.findClosest = function (schema) {
    const child = findChildWith(schema);
    if (child) return child;
    return origFindClosest(schema);
  };

  element.has = function (schema) {
    if (origHas(schema)) return true;
    return !!findChildWith(schema);
  };

  element.get = function (schema) {
    const own = origGet(schema);
    if (own) return own;
    const child = findChildWith(schema);
    return child ? child.get(schema) : null;
  };

  element.getOrCreate = function (schema) {
    const child = findChildWith(schema);
    if (child) return child.getOrCreate(schema);
    return origGetOrCreate(schema);
  };

  function setContainerRef(el) {
    containerEl = el;
  }

  const cleanup = render(
    () =>
      html`<div
        ref=${setContainerRef}
        style=${{
          position: 'relative',
          width: '100%',
          height: '100%',
        }}
      >
        <${For} each=${() => stack.children || []}>${(child, index) =>
            html`<div
              style=${() => ({
                position: 'absolute',
                inset: '0',
                'z-index': index(),
                'pointer-events': index() > 0 ? 'none' : 'auto',
              })}
            >
              <ref-view
                ref-url=${() => stackRef.at('children', index()).url}
                view-url=${() => child.viewUrl}
                style=${{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                }}
              />
            </div>`
          }</>
      </div>`,
    element,
  );

  return () => {
    element.findClosest = origFindClosest;
    element.has = origHas;
    element.get = origGet;
    element.getOrCreate = origGetOrCreate;
    cleanup();
  };
}
