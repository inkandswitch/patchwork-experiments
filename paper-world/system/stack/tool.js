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
  // element.findParent(surfaceSchema) and receive the *paper* ref-view
  // rather than the stack, because findParent delegates up to the stack's
  // resolveClosestDependency, which checks children first via findChildWith.
  const hadResolveClosestDependency = typeof element.resolveClosestDependency === 'function';
  const origHas = element.has.bind(element);
  const origFindClosest = element.findClosest.bind(element);
  const origGet = element.get.bind(element);
  const origGetOrCreate = element.getOrCreate.bind(element);
  const origResolveClosestDependency = hadResolveClosestDependency
    ? element.resolveClosestDependency.bind(element)
    : function (schema) {
        if (origHas(schema)) return element;
        const parent = element.parentElement?.closest('ref-view');
        if (!parent) return null;
        if (typeof parent.resolveClosestDependency === 'function') {
          return parent.resolveClosestDependency(schema);
        }
        return typeof parent.findClosest === 'function' ? parent.findClosest(schema) : null;
      };
  const origGetOwnSchemaRef =
    typeof element.getOwnSchemaRef === 'function'
      ? element.getOwnSchemaRef.bind(element)
      : origGet;
  const origGetOrCreateOwnSchemaRef =
    typeof element.getOrCreateOwnSchemaRef === 'function'
      ? element.getOrCreateOwnSchemaRef.bind(element)
      : origGetOrCreate;
  const recordSchemaDependency =
    typeof element.recordSchemaDependency === 'function'
      ? element.recordSchemaDependency.bind(element)
      : () => {};
  const recordParentDependency =
    typeof element.recordParentDependency === 'function'
      ? element.recordParentDependency.bind(element)
      : () => {};

  element.resolveClosestDependency = function (schema) {
    const child = findChildWith(schema);
    if (child) return child;
    return origResolveClosestDependency(schema);
  };

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
    const own = origGetOwnSchemaRef(schema);
    if (own) {
      recordSchemaDependency(schema);
      return own;
    }
    const child = findChildWith(schema);
    if (!child) return null;
    recordParentDependency(child, schema);
    if (typeof child.getOwnSchemaRef === 'function') {
      return child.getOwnSchemaRef(schema);
    }
    return child.get(schema);
  };

  element.getOrCreate = function (schema) {
    const child = findChildWith(schema);
    if (child) {
      recordParentDependency(child, schema);
      if (typeof child.getOrCreateOwnSchemaRef === 'function') {
        return child.getOrCreateOwnSchemaRef(schema);
      }
      return child.getOrCreate(schema);
    }
    recordSchemaDependency(schema);
    return origGetOrCreateOwnSchemaRef(schema);
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
    if (hadResolveClosestDependency) {
      element.resolveClosestDependency = origResolveClosestDependency;
    } else {
      delete element.resolveClosestDependency;
    }
    element.has = origHas;
    element.findClosest = origFindClosest;
    element.get = origGet;
    element.getOrCreate = origGetOrCreate;
    cleanup();
  };
}
