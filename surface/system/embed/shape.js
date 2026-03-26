import { from, createSignal, render, html } from '../solid.js';
import { toToolPath } from '../url.js';
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
    if (source && source !== data()?.embedToolUrl) {
      ref.change((d) => {
        d.embedToolUrl = source;
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

  function embedToolUrl() {
    return data()?.embedToolUrl;
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
          >
            ${() =>
              checkAndUpdate().map(
                (p) =>
                  html`<option
                    value=${toToolPath(p.source)}
                    selected=${toToolPath(p.source) === embedToolUrl()}
                  >${p.name}</option>`,
              )}
          </select>
        </div>
        <div
          class="embed-shape-body"
          onPointerDown=${(e) => e.stopPropagation()}
        >
          ${() =>
          embedDocUrl()
            ? html`<ref-view
                    tool-url=${embedToolUrl}
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
