import { from, createSignal, render, html } from '../solid.js';
import { toViewPath } from '../url.js';
import { schema } from './schema.js';
import styles from './shape.css' with { type: 'css' };

document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

export { schema };

const schemaCache = new Map();

async function loadSchema(schemaUrl) {
  if (schemaCache.has(schemaUrl)) return schemaCache.get(schemaUrl);
  const mod = await import(schemaUrl);
  schemaCache.set(schemaUrl, mod.schema);
  return mod.schema;
}

function findParentShapeInfo(element) {
  // Walk up from the embed's ref-view to find the parent frame
  // The embed ref-view is inside a positioned div, inside the paper's div, inside the paper's ref-view
  let node = element.parentElement;
  while (node) {
    if (node.tagName === 'REF-VIEW' && node.ref) {
      // This might be the parent frame - check if it has shapes
      try {
        const val = node.ref.value();
        if (val && val.shapes) {
          // Found the parent paper frame - now find which shape key we are
          const myRefUrl = element.ref.url;
          const shapes = val.shapes;
          for (const [id, shape] of Object.entries(shapes)) {
            const shapeRefUrl = node.ref.at('shapes', id).url;
            if (shapeRefUrl === myRefUrl) {
              return { parentRef: node.ref, shapeId: id };
            }
          }
        }
      } catch (e) {
        // not the right parent, keep looking
      }
    }
    node = node.parentElement;
  }
  return null;
}

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  const toolPlugins = from(element.plugins.byType('tool'));
  const [compatible, setCompatible] = createSignal([]);

  let compatVersion = 0;

  async function updateCompatiblePlugins() {
    const version = ++compatVersion;
    const docUrl = data()?.embedDocUrl;
    if (!docUrl) {
      setCompatible([]);
      return;
    }

    const repo = globalThis.repo;
    if (!repo || !globalThis.findRef) {
      setCompatible([]);
      return;
    }

    try {
      const docRef = await globalThis.findRef(repo, docUrl);
      if (version !== compatVersion) return;
      const value = docRef.value();

      const plugins = toolPlugins() ?? [];
      const results = [];
      for (const plugin of plugins) {
        if (!plugin.schemaUrl) continue;
        try {
          const pluginSchema = await loadSchema(plugin.schemaUrl);
          if (version !== compatVersion) return;
          pluginSchema.parse(value);
          results.push(plugin);
        } catch {
          // schema incompatible
        }
      }
      if (version === compatVersion) setCompatible(results);
    } catch {
      if (version === compatVersion) setCompatible([]);
    }
  }

  let lastDocUrl = undefined;
  let lastPluginCount = -1;
  function checkAndUpdate() {
    const docUrl = data()?.embedDocUrl;
    const pluginCount = (toolPlugins() ?? []).length;
    if (docUrl !== lastDocUrl || pluginCount !== lastPluginCount) {
      lastDocUrl = docUrl;
      lastPluginCount = pluginCount;
      updateCompatiblePlugins();
    }
    return compatible();
  }

  function onToolChange(event) {
    const source = event.target.value;
    if (source && source !== data()?.embedViewUrl) {
      ref.change((d) => {
        d.embedViewUrl = source;
      });
    }
  }

  function onClose(event) {
    event.stopPropagation();
    event.preventDefault();
    const info = findParentShapeInfo(element);
    if (info) {
      info.parentRef.at('shapes').change((shapes) => {
        delete shapes[info.shapeId];
      });
    }
  }

  function title() {
    const d = data();
    if (d?.title) return d.title;
    if (d?.name) return d.name;
    const url = element.ref.url ?? '';
    const lastSegment = url.split('/').pop();
    return lastSegment || '';
  }

  function embedDocUrl() {
    return data()?.embedDocUrl;
  }

  function embedViewUrl() {
    return data()?.embedViewUrl;
  }

  function embedWidth() {
    return `${data()?.width}px`;
  }

  function embedHeight() {
    return `${data()?.height}px`;
  }

  return render(
    () =>
      html`<div
        class="embed-shape"
        style=${() => ({ width: embedWidth(), height: embedHeight() })}
      >
        <div class="embed-shape-header">
          <span class="embed-shape-title">${title}</span>
          <select
            class="embed-tool-select"
            onChange=${onToolChange}
            onPointerDown=${(e) => e.stopPropagation()}
            value=${embedViewUrl}
          >
            ${() =>
              checkAndUpdate().map(
                (p) =>
                  html`<option
                    value=${toViewPath(p.source)}
                    selected=${toViewPath(p.source) === embedViewUrl()}
                  >${p.name}</option>`,
              )}
          </select>
          <button
            class="embed-close-btn"
            onClick=${onClose}
            onPointerDown=${(e) => e.stopPropagation()}
            title="Close"
          >✕</button>
        </div>
        <div
          class="embed-shape-body"
          onPointerDown=${(e) => e.stopPropagation()}
        >
          ${() =>
          embedDocUrl()
            ? html`<ref-view
                    view-url=${embedViewUrl}
                    ref-url=${embedDocUrl}
                  />`
            : html`<div class="embed-shape-placeholder">
                    No embedded document
                  </div>`}
        </div>
      </div>`,
    element,
  );
}
